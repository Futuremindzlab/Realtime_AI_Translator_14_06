import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { db, SETTINGS_TABLE } from '../db.mjs';
import { getRole } from '../auth.mjs';
import { sendSuccess, sendError, handleError } from '../response.mjs';
import { listAllCognitoUsers, buildIdentifierMap } from '../lib/cognitoUsers.mjs';
import { fetchAllPayments } from '../lib/razorpayReports.mjs';

/**
 * Admin-only payments overview — OWNER role required. Two independent
 * sections, each degrading to `available: false` on its own if its data
 * source is unreachable, rather than failing the whole payload:
 *
 *   - activeUsers: every settings record with plan !== 'basic' — this app's
 *     own DynamoDB is the authoritative record of who currently has paid
 *     access (kept in sync by billing.mjs's webhook handler), not Razorpay.
 *   - orders: the most recent Razorpay payments, live — deliberately not
 *     cached or stored locally (see chat: "live from Razorpay" was the
 *     chosen scope over a locally-stored transaction log).
 */
async function scanActiveUsers() {
  const items = [];
  let lastEvaluatedKey;
  do {
    const result = await db.send(new ScanCommand({
      TableName: SETTINGS_TABLE,
      // 'plan' is a DynamoDB reserved keyword — can't appear literally in a
      // ProjectionExpression (fails with "Invalid ProjectionExpression:
      // Attribute name is a reserved keyword; reserved keyword: plan").
      // Alias it via ExpressionAttributeNames instead; the returned Items
      // still come back keyed by the real attribute name 'plan', so nothing
      // downstream (item.plan below) needs to change.
      ProjectionExpression: 'user_id, #plan, razorpay_subscription_id, razorpay_subscription_status, updated_at',
      ExpressionAttributeNames: { '#plan': 'plan' },
      ExclusiveStartKey: lastEvaluatedKey,
    }));
    items.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items.filter((item) => item.plan && item.plan !== 'basic');
}

function formatOrder(payment) {
  return {
    id: payment.id,
    orderId: payment.order_id || null,
    amount: Math.round(payment.amount) / 100, // paise → rupees
    currency: payment.currency,
    status: payment.status,
    method: payment.method || null,
    email: payment.email || null,
    contact: payment.contact || null,
    plan: payment.notes?.plan || null,
    userId: payment.notes?.user_id || null,
    createdAt: new Date(payment.created_at * 1000).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────
// GET /v1/admin/payments  (OWNER only)
// ─────────────────────────────────────────────────────────
export async function getPaymentsOverview(event) {
  try {
    if (getRole(event) !== 'OWNER') return sendError(403, 'OWNER role required');

    const [activeUserRows, cognitoUsers, ordersResult] = await Promise.all([
      scanActiveUsers(),
      listAllCognitoUsers(process.env.USER_POOL_ID),
      fetchAllPayments().catch((err) => {
        console.error('Razorpay payments fetch failed:', err.message);
        return null;
      }),
    ]);

    const identifierMap = buildIdentifierMap(cognitoUsers);

    const activeUsers = activeUserRows
      .map((u) => ({
        userId: u.user_id,
        identifier: identifierMap.get(u.user_id) || u.user_id,
        plan: u.plan,
        subscriptionId: u.razorpay_subscription_id || null,
        subscriptionStatus: u.razorpay_subscription_status || null,
        updatedAt: u.updated_at,
      }))
      .sort((a, b) => a.identifier.localeCompare(b.identifier));

    const orders = ordersResult
      ? { available: true, items: ordersResult.map(formatOrder).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
      : {
          available: false,
          reason: 'Razorpay unreachable or not configured (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET) — see RAZORPAY_INTEGRATION.md',
          items: [],
        };

    return sendSuccess({
      generatedAt: new Date().toISOString(),
      activeUsers,
      orders,
    });
  } catch (err) {
    return handleError(err);
  }
}
