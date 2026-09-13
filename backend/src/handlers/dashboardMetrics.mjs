/**
 * Business dashboard metrics — OWNER role required.
 *
 * Four sections in one payload: engagement (WAU/MAU), awsCost, revenue and
 * churn are all real now. revenue/churn are computed from Razorpay
 * (backend/src/lib/razorpayReports.mjs) cross-referenced with this table's
 * own `plan`/`razorpay_subscription_id`/`razorpay_subscription_status`
 * fields — see that file's header comments for exactly how "revenue by
 * tier" and "expiring within 7 days" are derived. Each section still
 * degrades to `available: false` with a `reason` (rather than a fake zero)
 * if Razorpay/Cost Explorer is unreachable or unconfigured, so the client
 * can render an honest empty state instead of a misleading one.
 *
 * Cost Explorer bills $0.01 per API request — cached in-memory for the
 * lifetime of the warm Lambda container (COST_CACHE_TTL_MS) so repeated
 * dashboard loads within that window don't re-trigger it.
 */

import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getRole } from '../auth.mjs';
import { sendSuccess, sendError, handleError } from '../response.mjs';
import { scanAllTranslations, buildUsageByUser, countActiveWithin } from '../lib/usageAnalytics.mjs';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { listAllCognitoUsers, buildIdentifierMap } from '../lib/cognitoUsers.mjs';
import { fetchAllPayments, fetchAllSubscriptions, computeRevenueByTier, computeChurn } from '../lib/razorpayReports.mjs';
import { db, SETTINGS_TABLE } from '../db.mjs';

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

/** Every settings record's billing-relevant fields — used by computeChurn(). */
async function scanUserSubscriptionStates() {
  const items = [];
  let lastEvaluatedKey;
  do {
    const result = await db.send(new ScanCommand({
      TableName: SETTINGS_TABLE,
      ProjectionExpression: 'user_id, plan, razorpay_subscription_id, razorpay_subscription_status',
      ExclusiveStartKey: lastEvaluatedKey,
    }));
    items.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  return items;
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

    const [translations, totalMembers, awsCost, paymentsResult, subscriptionsResult, dbUsers, cognitoUsers] =
      await Promise.all([
        scanAllTranslations(),
        countCognitoUsers(process.env.USER_POOL_ID),
        getAwsCost(),
        // Degrade to null (→ available: false below) rather than failing the
        // whole dashboard payload — same treatment getAwsCost() gives Cost
        // Explorer being unreachable/unconfigured.
        fetchAllPayments().catch((err) => {
          console.error('Razorpay payments fetch failed:', err.message);
          return null;
        }),
        fetchAllSubscriptions().catch((err) => {
          console.error('Razorpay subscriptions fetch failed:', err.message);
          return null;
        }),
        scanUserSubscriptionStates(),
        listAllCognitoUsers(process.env.USER_POOL_ID),
      ]);

    const usageByUser = buildUsageByUser(translations);
    const identifierMap = buildIdentifierMap(cognitoUsers);

    const revenue = paymentsResult
      ? computeRevenueByTier(paymentsResult)
      : {
          available: false,
          reason: 'Razorpay unreachable or not configured (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET) — see RAZORPAY_INTEGRATION.md',
          currency: 'INR',
          total: null,
          byTier: [],
        };

    const churn = subscriptionsResult
      ? computeChurn(dbUsers, subscriptionsResult, identifierMap)
      : {
          available: false,
          reason: 'Razorpay unreachable or not configured (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET) — see RAZORPAY_INTEGRATION.md',
          users: [],
        };

    return sendSuccess({
      generatedAt: new Date().toISOString(),
      revenue,
      engagement: {
        available: true,
        totalMembers,
        wau: countActiveWithin(usageByUser, 7, totalMembers),
        mau: countActiveWithin(usageByUser, 30, totalMembers),
      },
      awsCost,
      churn,
    });
  } catch (err) {
    return handleError(err);
  }
}
