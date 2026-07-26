/**
 * Admin-only cross-user analytics — OWNER role required.
 *
 * Every other route in this backend scopes DynamoDB access to the calling
 * user's own partition (user_id = the authenticated Cognito sub). This route
 * is the deliberate exception: it Scans conversation_history across every
 * user to compute usage stats for the internal ops dashboard. Two guards
 * keep that safe: the OWNER role check below, and a ProjectionExpression
 * (in lib/usageAnalytics.mjs) that never pulls source_text/translated_text —
 * the dashboard needs usage patterns, not the ability to read anyone's
 * actual translated messages.
 *
 * Region, gender, churn risk and retention cohorts are NOT included — none
 * of that is collected anywhere in Cognito or DynamoDB today. The client
 * should treat `unavailable` as the list of dashboard sections with no real
 * data source yet, rather than inferring it from missing fields.
 */

import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getRole } from '../auth.mjs';
import { sendSuccess, sendError, handleError } from '../response.mjs';
import { scanAllTranslations, buildUsageByUser, countActiveWithin } from '../lib/usageAnalytics.mjs';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

async function listAllCognitoUsers(userPoolId) {
  const users = [];
  let paginationToken;
  do {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: userPoolId,
      PaginationToken: paginationToken,
    }));
    users.push(...(result.Users || []));
    paginationToken = result.PaginationToken;
  } while (paginationToken);
  return users;
}

function attr(user, name) {
  const found = (user.Attributes || []).find((a) => a.Name === name);
  return found ? found.Value : null;
}

// ─────────────────────────────────────────────────────────
// GET /v1/admin/user-analytics  (OWNER only)
// ─────────────────────────────────────────────────────────
export async function getUserAnalytics(event) {
  try {
    if (getRole(event) !== 'OWNER') return sendError(403, 'OWNER role required');

    const [translations, cognitoUsers] = await Promise.all([
      scanAllTranslations(),
      listAllCognitoUsers(process.env.USER_POOL_ID),
    ]);

    const usageByUser = buildUsageByUser(translations);

    const users = cognitoUsers.map((u) => {
      const sub = attr(u, 'sub');
      const usage = usageByUser.get(sub) || { translationCount: 0, conversationModeCount: 0, lastActive: null, languagePairs: {} };
      const topLanguagePairs = Object.entries(usage.languagePairs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([pair, count]) => ({ pair, count }));

      return {
        userId: sub,
        identifier: attr(u, 'email') || attr(u, 'phone_number') || u.Username,
        status: u.UserStatus,
        signedUpAt: u.UserCreateDate,
        translationCount: usage.translationCount,
        conversationModeCount: usage.conversationModeCount,
        lastActive: usage.lastActive,
        topLanguagePairs,
      };
    });

    users.sort((a, b) => b.translationCount - a.translationCount);

    return sendSuccess({
      generatedAt: new Date().toISOString(),
      totalMembers: users.length,
      totalTranslations: translations.length,
      activeRates: {
        d7: countActiveWithin(usageByUser, 7, users.length),
        d30: countActiveWithin(usageByUser, 30, users.length),
        d90: countActiveWithin(usageByUser, 90, users.length),
      },
      users,
      unavailable: ['region', 'gender', 'churnRisk', 'retentionCohorts'],
    });
  } catch (err) {
    return handleError(err);
  }
}
