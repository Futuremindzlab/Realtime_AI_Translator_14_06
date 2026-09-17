import { getRole } from '../auth.mjs';
import { sendSuccess, sendError, handleError } from '../response.mjs';
import { listAllCognitoUsers, buildIdentifierMap } from '../lib/cognitoUsers.mjs';
import { fetchAllSubscriptions, computeSubscriptionsOverview } from '../lib/razorpayReports.mjs';

const UNAVAILABLE_REASON =
  'Razorpay unreachable or not configured (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET) — see RAZORPAY_INTEGRATION.md';

// ─────────────────────────────────────────────────────────
// GET /v1/admin/subscriptions  (OWNER only)
//
// Purpose-built payment-tracking view, split out from adminPayments.mjs's
// broader "everything about payments" page: active-subscriber counts + MRR
// per plan (plus vs. live), subscriptions renewing within the next 7 days,
// and subscriptions Razorpay is currently struggling to charge
// (pending/halted). See razorpayReports.mjs's computeSubscriptionsOverview
// for exactly how each section is derived.
// ─────────────────────────────────────────────────────────
export async function getSubscriptionsOverview(event) {
  try {
    if (getRole(event) !== 'OWNER') return sendError(403, 'OWNER role required');

    const [subscriptionsResult, cognitoUsers] = await Promise.all([
      fetchAllSubscriptions().catch((err) => {
        console.error('Razorpay subscriptions fetch failed:', err.message);
        return null;
      }),
      listAllCognitoUsers(process.env.USER_POOL_ID),
    ]);

    const identifierMap = buildIdentifierMap(cognitoUsers);

    const overview = subscriptionsResult
      ? computeSubscriptionsOverview(subscriptionsResult, identifierMap)
      : {
          available: false,
          reason: UNAVAILABLE_REASON,
          byPlan: { plus: { activeCount: 0, mrr: 0 }, live: { activeCount: 0, mrr: 0 } },
          statusBreakdown: {},
          expiringWithinWeek: [],
          needsAttention: [],
        };

    return sendSuccess({ generatedAt: new Date().toISOString(), ...overview });
  } catch (err) {
    return handleError(err);
  }
}
