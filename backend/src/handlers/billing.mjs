import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, SETTINGS_TABLE } from '../db.mjs';
import { getUserId } from '../auth.mjs';
import { sendSuccess, sendError, handleError } from '../response.mjs';
import { razorpay, planIdFor, verifySubscriptionPaymentSignature, verifyWebhookSignature } from '../lib/razorpay.mjs';
import { fetchAllPayments } from '../lib/razorpayReports.mjs';
import {
  planForProductId,
  verifyAndDecodeTransaction,
  verifyAndDecodeNotification,
  VerificationException,
} from '../lib/appleIap.mjs';

const PAID_PLANS = ['plus', 'live'];

// Razorpay requires a total_count for a subscription without a fixed end date
// (there's no literal "forever"); 120 monthly cycles = 10 years, renewing
// automatically each month until the user (or a failed-payment chain) cancels
// it — effectively unbounded for this app's purposes.
const TOTAL_MONTHLY_CYCLES = 120;

/**
 * Writes plan + subscription bookkeeping to a user's settings record.
 * Shared by the post-checkout verify call and the webhook handler so both
 * paths update the exact same fields the same way.
 */
async function applySubscriptionState(userId, { plan, subscriptionId, status }) {
  const result = await db.send(new UpdateCommand({
    TableName: SETTINGS_TABLE,
    Key: { user_id: userId },
    // 'plan' is a DynamoDB reserved keyword (part of its SQL-like expression
    // grammar) — using it bare in an UpdateExpression fails at request time
    // with "Invalid UpdateExpression: Attribute name is a reserved word",
    // regardless of what's actually stored in the table. Every caller of
    // this function (the post-checkout verify path AND both webhook
    // branches — see call sites below) hit this on every real attempt,
    // silently failing to ever activate or downgrade a subscription: the
    // customer's payment succeeds on Razorpay's side, but their `plan` here
    // never updates. ExpressionAttributeNames aliases it to sidestep the
    // reserved-word rule; see the DynamoDB reserved-words list for others
    // (https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html).
    UpdateExpression: 'SET #plan = :p, razorpay_subscription_id = :s, razorpay_subscription_status = :st, updated_at = :u',
    ExpressionAttributeNames: {
      '#plan': 'plan',
    },
    ExpressionAttributeValues: {
      ':p': plan,
      ':s': subscriptionId,
      ':st': status,
      ':u': new Date().toISOString(),
    },
    ReturnValues: 'ALL_NEW',
  }));
  return result.Attributes;
}

// ─────────────────────────────────────────────────────────
// POST /v1/billing/razorpay/create-subscription
// Body: { plan: 'plus' | 'live' }
// ─────────────────────────────────────────────────────────
export async function createSubscription(event) {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const { plan } = body;

    if (!PAID_PLANS.includes(plan)) {
      return sendError(400, `plan must be one of: ${PAID_PLANS.join(', ')}`);
    }

    const planId = planIdFor(plan);
    if (!planId) {
      // RAZORPAY_PLAN_ID_PLUS/LIVE not set — see scripts/setup-razorpay-plans.mjs.
      return sendError(500, `Billing is not configured for the '${plan}' plan yet.`);
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: TOTAL_MONTHLY_CYCLES,
      quantity: 1,
      customer_notify: true,
      // Round-tripped through Razorpay unmodified — the webhook and verify
      // handlers below read these back as the authoritative source of which
      // user/plan a given subscription belongs to, rather than trusting
      // whatever the client claims at verify time.
      notes: { user_id: userId, plan },
    });

    return sendSuccess({
      subscription_id: subscription.id,
      key_id: process.env.RAZORPAY_KEY_ID, // public — safe to hand to the client for Checkout
      plan,
    });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/billing/razorpay/verify
// Body: { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
//
// Fast, in-app confirmation right after Checkout succeeds. The webhook
// handler below is the durable source of truth (covers the app being killed
// or losing connectivity right after payment, and all future renewals this
// call is never involved in) — this just makes the UI update immediately
// instead of waiting on a webhook round-trip.
// ─────────────────────────────────────────────────────────
export async function verifySubscriptionPayment(event) {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const { razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId, razorpay_signature: signature } = body;

    if (!paymentId || !subscriptionId || !signature) {
      return sendError(400, 'razorpay_payment_id, razorpay_subscription_id and razorpay_signature are required');
    }

    if (!verifySubscriptionPaymentSignature({ paymentId, subscriptionId, signature })) {
      return sendError(400, 'Invalid payment signature');
    }

    // Don't trust a client-supplied plan — read it back from the subscription
    // itself (set server-side in createSubscription's `notes`), and confirm
    // the subscription actually belongs to the caller.
    const subscription = await razorpay.subscriptions.fetch(subscriptionId);
    if (subscription.notes?.user_id !== userId) {
      return sendError(403, 'This subscription does not belong to the authenticated user');
    }
    const plan = subscription.notes?.plan;
    if (!PAID_PLANS.includes(plan)) {
      return sendError(500, `Subscription ${subscriptionId} has no valid plan in its notes`);
    }

    const updated = await applySubscriptionState(userId, { plan, subscriptionId, status: 'active' });
    return sendSuccess(updated);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/billing/razorpay/cancel
// Self-serve cancellation — cancels at the end of the current billing cycle
// so a user who already paid for the month keeps access through it, rather
// than being cut off immediately. The plan downgrade itself happens when the
// webhook's subscription.cancelled event actually arrives at cycle end.
// ─────────────────────────────────────────────────────────
export async function cancelSubscription(event) {
  try {
    const userId = getUserId(event);

    const existing = await db.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { user_id: userId } }));
    const subscriptionId = existing.Item?.razorpay_subscription_id;
    if (!subscriptionId) {
      return sendError(400, 'No active subscription to cancel');
    }

    await razorpay.subscriptions.cancel(subscriptionId, { cancel_at_cycle_end: true });

    const result = await db.send(new UpdateCommand({
      TableName: SETTINGS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'SET razorpay_subscription_status = :st, updated_at = :u',
      ExpressionAttributeValues: { ':st': 'cancel_requested', ':u': new Date().toISOString() },
      ReturnValues: 'ALL_NEW',
    }));

    return sendSuccess(result.Attributes);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /v1/billing/history
// Self-serve payment history — the user-facing counterpart to
// adminPayments.mjs's OWNER-only view. Reuses the same fetchAllPayments
// (most-recent-1000 Razorpay payments) and filters down to payments whose
// notes.user_id matches the caller, rather than trusting anything the
// client sends — same "notes is the source of truth" pattern verify/webhook
// already use above.
// ─────────────────────────────────────────────────────────
export async function getMyBillingHistory(event) {
  try {
    const userId = getUserId(event);

    const payments = await fetchAllPayments();
    const items = payments
      .filter((p) => p.notes?.user_id === userId)
      .map((p) => ({
        id: p.id,
        amount: Math.round(p.amount) / 100, // paise → rupees
        currency: p.currency,
        status: p.status,
        method: p.method || null,
        plan: p.notes?.plan || null,
        createdAt: new Date(p.created_at * 1000).toISOString(),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return sendSuccess({ available: true, items });
  } catch (err) {
    if (err.statusCode) return handleError(err);
    console.error('Razorpay payments fetch failed:', err.message);
    return sendSuccess({
      available: false,
      reason: 'Razorpay unreachable or not configured (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET) — see RAZORPAY_INTEGRATION.md',
      items: [],
    });
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/billing/razorpay/webhook  (UNAUTHENTICATED — see template.yaml;
// Razorpay's servers call this directly, there's no Cognito token to check)
//
// The durable source of truth for subscription state: covers renewals
// (subscription.charged, fired every month with zero app involvement),
// failed-payment chains (subscription.pending → subscription.halted), and
// cancellations, none of which the client is ever present for.
//
// event.body here is the RAW string API Gateway handed the Lambda proxy —
// critical that this handler verifies the signature against that raw string
// BEFORE JSON.parse-ing it (see verifyWebhookSignature's comment).
// ─────────────────────────────────────────────────────────
export async function handleWebhook(event) {
  try {
    const rawBody = event.body || '';
    // API Gateway (REST API) preserves the header casing the caller sent —
    // don't assume 'x-razorpay-signature' vs 'X-Razorpay-Signature'.
    const headerKey = Object.keys(event.headers || {}).find((k) => k.toLowerCase() === 'x-razorpay-signature');
    const signatureHeader = headerKey ? event.headers[headerKey] : undefined;

    if (!verifyWebhookSignature(rawBody, signatureHeader)) {
      console.error('❌ Razorpay webhook signature mismatch — rejecting');
      return sendError(400, 'Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.event;
    const subscriptionEntity = payload.payload?.subscription?.entity;
    const userId = subscriptionEntity?.notes?.user_id;
    const plan = subscriptionEntity?.notes?.plan;
    const subscriptionId = subscriptionEntity?.id;

    if (!userId || !subscriptionId) {
      // Not every webhook event carries a subscription entity (e.g. plain
      // payment events for one-time orders, which this app doesn't use) —
      // acknowledge with 200 so Razorpay doesn't retry something we'll never
      // be able to act on.
      console.log(`ℹ️ Razorpay webhook '${eventType}' had no subscription/user context — ignoring`);
      return sendSuccess({ received: true });
    }

    console.log(`📩 Razorpay webhook: ${eventType} for user ${userId}, subscription ${subscriptionId}`);

    switch (eventType) {
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed':
        // Active-and-in-good-standing states — (re)apply the paid plan. Covers
        // first activation, every successful monthly renewal, and un-pausing.
        if (PAID_PLANS.includes(plan)) {
          await applySubscriptionState(userId, { plan, subscriptionId, status: eventType.split('.')[1] });
        }
        break;

      case 'subscription.pending':
        // A renewal payment failed but Razorpay is still retrying — record
        // the status for UI visibility (e.g. "payment issue, update your
        // card") without downgrading yet; subscription.halted below is what
        // actually ends access if retries exhaust.
        await db.send(new UpdateCommand({
          TableName: SETTINGS_TABLE,
          Key: { user_id: userId },
          UpdateExpression: 'SET razorpay_subscription_status = :st, updated_at = :u',
          ExpressionAttributeValues: { ':st': 'pending', ':u': new Date().toISOString() },
        }));
        break;

      case 'subscription.halted':
      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.paused':
        // Access-ending states — downgrade to the free tier. entitlement.mjs's
        // getUserPlan() defaults anything not in PLANS to 'basic' anyway, but
        // writing it explicitly keeps settings.tsx's UI (which reads `plan`
        // directly) in sync too.
        await applySubscriptionState(userId, { plan: 'basic', subscriptionId, status: eventType.split('.')[1] });
        break;

      default:
        console.log(`ℹ️ Unhandled Razorpay webhook event type: ${eventType}`);
    }

    return sendSuccess({ received: true });
  } catch (err) {
    // Razorpay retries on non-2xx, but a malformed/unexpected payload
    // shouldn't retry forever — log it and acknowledge rather than 500-loop.
    console.error('❌ Razorpay webhook handler error:', err);
    return sendSuccess({ received: true, error: 'handler_error' });
  }
}

// ═════════════════════════════════════════════════════════
// Apple In-App Purchase (App Store subscriptions) — the iOS counterpart to
// the Razorpay flow above (used on Android). See APPLE_IAP_INTEGRATION.md.
//
// One real design difference from Razorpay worth calling out: there is no
// server-side "create subscription" step here — the client purchases
// directly against Apple's StoreKit (react-native-iap's requestPurchase()),
// so there's no equivalent of Razorpay's subscription.notes to stash
// user_id/plan in ahead of time. Apple's own mechanism for the same job is
// appAccountToken: the client sets it (to the caller's Cognito user id, a
// UUID — the exact shape StoreKit requires) on the purchase request, Apple
// embeds it into the signed transaction, and it comes back out on every
// verify/webhook decode below. Trusting decoded.appAccountToken (never a
// client-supplied claim) is this integration's equivalent of Razorpay's
// "trust subscription.notes.user_id, not the client" pattern.
//
// The other real difference: Apple does not offer any server API to cancel
// a user's subscription — by Apple's own design, that can only happen
// through the user's own Apple ID (Settings app, or App Store ▸ profile ▸
// Subscriptions). There is deliberately no /v1/billing/apple/cancel route
// here; the client-side equivalent is react-native-iap's
// showManageSubscriptionsIOS(), which opens Apple's own management sheet.
// ═════════════════════════════════════════════════════════

/** Same job as applySubscriptionState above, kept as a separate function
 *  (not a generalized/shared one) so nothing about the already-working
 *  Razorpay write path changes — this only touches the parallel
 *  apple_original_transaction_id / apple_subscription_status fields. */
async function applyAppleSubscriptionState(userId, { plan, originalTransactionId, status }) {
  const result = await db.send(new UpdateCommand({
    TableName: SETTINGS_TABLE,
    Key: { user_id: userId },
    UpdateExpression: 'SET #plan = :p, apple_original_transaction_id = :t, apple_subscription_status = :st, updated_at = :u',
    ExpressionAttributeNames: { '#plan': 'plan' },
    ExpressionAttributeValues: {
      ':p': plan,
      ':t': originalTransactionId,
      ':st': status,
      ':u': new Date().toISOString(),
    },
    ReturnValues: 'ALL_NEW',
  }));
  return result.Attributes;
}

/** Pulls the fields this integration actually needs off a decoded Apple
 *  transaction payload (shared by verify and webhook below), and validates
 *  the ones that matter for trust: a productId that actually maps to one of
 *  our plans, and a bundleId that matches this deployment (defense in depth
 *  — verifyAndDecodeTransaction's verifier is already constructed for one
 *  specific bundle ID and is expected to reject a mismatch on its own, but
 *  checking it again here costs nothing and this is exactly the kind of
 *  check worth not relying on a single layer for). */
function extractSubscriptionFields(decoded) {
  if (decoded.bundleId && decoded.bundleId !== process.env.APPLE_BUNDLE_ID) {
    return { error: `Transaction bundleId '${decoded.bundleId}' does not match this deployment` };
  }
  const plan = planForProductId(decoded.productId);
  if (!plan) {
    return { error: `productId '${decoded.productId}' does not map to a known plan — see APPLE_IAP_INTEGRATION.md` };
  }
  if (!decoded.appAccountToken) {
    return { error: 'Transaction has no appAccountToken — cannot determine which user this purchase belongs to' };
  }
  return {
    plan,
    userId: decoded.appAccountToken,
    originalTransactionId: decoded.originalTransactionId,
  };
}

// ─────────────────────────────────────────────────────────
// POST /v1/billing/apple/verify
// Body: { signedTransactionInfo }  — the JWS react-native-iap's
// getTransactionJwsIOS() returns right after a purchase completes.
//
// Fast, in-app confirmation, same role as verifySubscriptionPayment above —
// the App Store Server Notification webhook below is the durable source of
// truth for renewals/expiry/refunds, which this call is never involved in.
// ─────────────────────────────────────────────────────────
export async function verifyApplePurchase(event) {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const { signedTransactionInfo } = body;

    if (!signedTransactionInfo) {
      return sendError(400, 'signedTransactionInfo is required');
    }

    let decoded;
    try {
      decoded = await verifyAndDecodeTransaction(signedTransactionInfo);
    } catch (err) {
      if (err instanceof VerificationException) {
        return sendError(400, 'Invalid transaction signature');
      }
      throw err;
    }

    const fields = extractSubscriptionFields(decoded);
    if (fields.error) return sendError(400, fields.error);

    // Never trust the caller's own JWT alone for *which* purchase this is —
    // confirm the token embedded in the (already signature-verified)
    // transaction actually belongs to the authenticated caller, same
    // ownership check Razorpay's verify does against subscription.notes.user_id.
    if (fields.userId !== userId) {
      return sendError(403, 'This transaction does not belong to the authenticated user');
    }

    const updated = await applyAppleSubscriptionState(userId, {
      plan: fields.plan,
      originalTransactionId: fields.originalTransactionId,
      status: 'active',
    });
    return sendSuccess(updated);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/billing/apple/notifications  (UNAUTHENTICATED — see template.yaml;
// Apple's servers call this directly, there's no Cognito token to check)
//
// App Store Server Notifications V2 — the durable source of truth for
// renewals (DID_RENEW, fired every cycle with zero app involvement), grace
// periods / failed renewals, refunds, and revocations, none of which the
// client is ever present for. Body: { signedPayload } — see
// https://developer.apple.com/documentation/appstoreservernotifications.
// ─────────────────────────────────────────────────────────
export async function handleAppleNotification(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { signedPayload } = body;
    if (!signedPayload) return sendSuccess({ received: true });

    let notification;
    try {
      notification = await verifyAndDecodeNotification(signedPayload);
    } catch (err) {
      if (err instanceof VerificationException) {
        console.error('❌ Apple notification signature/chain verification failed — rejecting');
        return sendError(400, 'Invalid notification signature');
      }
      throw err;
    }

    const signedTransactionInfo = notification.data?.signedTransactionInfo;
    if (!signedTransactionInfo) {
      // Not every notification type carries transaction data (e.g. TEST,
      // CONSUMPTION_REQUEST for a one-time IAP this app doesn't sell) —
      // acknowledge with 200 so Apple doesn't retry something we can't act on.
      console.log(`ℹ️ Apple notification '${notification.notificationType}' had no transaction data — ignoring`);
      return sendSuccess({ received: true });
    }

    // The outer notification envelope is its own signed JWS; the transaction
    // it describes is a SEPARATE, nested signed JWS inside it — both need
    // independent signature verification, which is why this decodes it via
    // the same verifyAndDecodeTransaction verify path verifyApplePurchase uses,
    // rather than trusting the inner payload just because the outer one checked out.
    let decoded;
    try {
      decoded = await verifyAndDecodeTransaction(signedTransactionInfo);
    } catch (err) {
      if (err instanceof VerificationException) {
        console.error('❌ Apple notification\'s nested transaction failed verification — rejecting');
        return sendError(400, 'Invalid transaction signature');
      }
      throw err;
    }

    const fields = extractSubscriptionFields(decoded);
    if (fields.error) {
      console.log(`ℹ️ Apple notification '${notification.notificationType}' — ${fields.error}, ignoring`);
      return sendSuccess({ received: true });
    }

    const notificationType = notification.notificationType;
    const subtype = notification.subtype;
    console.log(`📩 Apple notification: ${notificationType}${subtype ? `/${subtype}` : ''} for user ${fields.userId}`);

    switch (notificationType) {
      case 'SUBSCRIBED':
      case 'DID_RENEW':
        // Active-and-in-good-standing — (re)apply the paid plan. Covers first
        // purchase, resubscribing, and every successful renewal charge.
        await applyAppleSubscriptionState(fields.userId, {
          plan: fields.plan,
          originalTransactionId: fields.originalTransactionId,
          status: 'active',
        });
        break;

      case 'DID_FAIL_TO_RENEW':
        // GRACE_PERIOD: Apple is still retrying and the user keeps access
        // during the grace window — record status without downgrading.
        // Anything else here (no successful retry, no grace period offered)
        // isn't access-ending on its own either; GRACE_PERIOD_EXPIRED below
        // is what actually ends access once retries are exhausted.
        await db.send(new UpdateCommand({
          TableName: SETTINGS_TABLE,
          Key: { user_id: fields.userId },
          UpdateExpression: 'SET apple_subscription_status = :st, updated_at = :u',
          ExpressionAttributeValues: { ':st': subtype === 'GRACE_PERIOD' ? 'grace_period' : 'billing_retry', ':u': new Date().toISOString() },
        }));
        break;

      case 'EXPIRED':
      case 'GRACE_PERIOD_EXPIRED':
      case 'REFUND':
      case 'REVOKE':
        // Access-ending states — downgrade to the free tier. entitlement.mjs's
        // getUserPlan() defaults anything not in PLANS to 'basic' anyway, but
        // writing it explicitly keeps settings.tsx's UI (reads `plan` directly)
        // in sync too — same reasoning as the Razorpay webhook above.
        await applyAppleSubscriptionState(fields.userId, {
          plan: 'basic',
          originalTransactionId: fields.originalTransactionId,
          status: notificationType.toLowerCase(),
        });
        break;

      case 'DID_CHANGE_RENEWAL_STATUS':
        // Just an auto-renew toggle (subtype AUTO_RENEW_ENABLED/DISABLED) —
        // the user keeps access through the already-paid period either way;
        // EXPIRED above is what actually ends it if they don't turn it back on.
        break;

      default:
        console.log(`ℹ️ Unhandled Apple notification type: ${notificationType}`);
    }

    return sendSuccess({ received: true });
  } catch (err) {
    // Same reasoning as the Razorpay webhook handler: Apple retries on
    // non-2xx, but a malformed/unexpected payload shouldn't retry forever.
    console.error('❌ Apple notification handler error:', err);
    return sendSuccess({ received: true, error: 'handler_error' });
  }
}
