/**
 * Business dashboard metrics — OWNER role required.
 *
 * Four sections in one payload: engagement (WAU/MAU) and awsCost are real,
 * computed from conversation_history/Cognito and AWS Cost Explorer. revenue
 * and churn are NOT real — there is no Transactions table, no product-tier
 * field, and no subscription/expiry data anywhere in this backend (billing
 * is still just the Razorpay design in BILLING.md, not implemented). Both
 * are returned with `available: false` and a reason instead of being
 * silently omitted or faked, so the client can render an honest empty state.
 *
 * Cost Explorer bills $0.01 per API request — cached in-memory for the
 * lifetime of the warm Lambda container (COST_CACHE_TTL_MS) so repeated
 * dashboard loads within that window don't re-trigger it.
 */

import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { getRole } from '../auth.mjs';
import { sendSuccess, sendError, handleError } from '../response.mjs';
import { scanAllTranslations, buildUsageByUser, countActiveWithin } from '../lib/usageAnalytics.mjs';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

// Cost Explorer is a global service reachable only via the us-east-1 endpoint,
// regardless of which region the rest of this stack runs in.
const costExplorer = new CostExplorerClient({ region: 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

const COST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let costCache = null; // { value, fetchedAt }

async function countCognitoUsers(userPoolId) {
  let total = 0;
  let paginationToken;
  do {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: userPoolId,
      PaginationToken: paginationToken,
      AttributesToGet: [], // count only — skip pulling attributes we don't need here
    }));
    total += (result.Users || []).length;
    paginationToken = result.PaginationToken;
  } while (paginationToken);
  return total;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Exported so infraMetrics.mjs can reuse the same Cost Explorer call (and its
// in-memory cache) instead of paying the $0.01/request fee a second time.
export async function getAwsCost() {
  if (costCache && Date.now() - costCache.fetchedAt < COST_CACHE_TTL_MS) {
    return costCache.value;
  }

  try {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Cost Explorer's End is exclusive

    const result = await costExplorer.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: isoDate(start), End: isoDate(end) },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    }));

    const period = result.ResultsByTime?.[0];
    const byService = (period?.Groups || [])
      .map((g) => ({
        service: g.Keys?.[0] || 'Unknown',
        costUsd: Math.round(parseFloat(g.Metrics?.UnblendedCost?.Amount || '0') * 100) / 100,
      }))
      .filter((s) => s.costUsd > 0)
      .sort((a, b) => b.costUsd - a.costUsd);

    const totalUsd = Math.round(byService.reduce((sum, s) => sum + s.costUsd, 0) * 100) / 100;

    const value = {
      available: true,
      periodStart: period?.TimePeriod?.Start ?? null,
      periodEnd: period?.TimePeriod?.End ?? null,
      totalUsd,
      byService,
    };
    costCache = { value, fetchedAt: Date.now() };
    return value;
  } catch (err) {
    // Cost Explorer must be enabled in Billing Preferences and can take up to
    // 24h after first enabling before it serves data — degrade honestly
    // instead of failing the whole dashboard payload.
    return {
      available: false,
      reason: `AWS Cost Explorer unavailable: ${err.message}`,
      totalUsd: null,
      byService: [],
    };
  }
}

// ─────────────────────────────────────────────────────────
// GET /v1/admin/dashboard-metrics  (OWNER only)
// ─────────────────────────────────────────────────────────
export async function getDashboardMetrics(event) {
  try {
    if (getRole(event) !== 'OWNER') return sendError(403, 'OWNER role required');

    const [translations, totalMembers, awsCost] = await Promise.all([
      scanAllTranslations(),
      countCognitoUsers(process.env.USER_POOL_ID),
      getAwsCost(),
    ]);

    const usageByUser = buildUsageByUser(translations);

    return sendSuccess({
      generatedAt: new Date().toISOString(),
      revenue: {
        available: false,
        reason: 'No Transactions table or billing system implemented yet — see BILLING.md',
        totalUsd: null,
        byTier: [],
      },
      engagement: {
        available: true,
        totalMembers,
        wau: countActiveWithin(usageByUser, 7, totalMembers),
        mau: countActiveWithin(usageByUser, 30, totalMembers),
      },
      awsCost,
      churn: {
        available: false,
        reason: 'No subscription/expiry data exists yet — no GSI, no renewal_notification_sent field',
        users: [],
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
