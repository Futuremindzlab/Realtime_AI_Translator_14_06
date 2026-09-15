import crypto from 'node:crypto';
import Razorpay from 'razorpay';

/**
 * Singleton Razorpay client, reused across warm Lambda invocations — same
 * pattern as db.mjs's DynamoDB client.
 *
 * RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET come from backend/template.yaml
 * (RazorpayKeyId / RazorpayKeySecret parameters) — the secret never reaches
 * the client, same treatment as OPENAI_API_KEY etc.
 */
export const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Paid subscription tiers and their monthly price, in paise (Razorpay's
 * smallest-unit convention — ₹1 = 100 paise). Kept alongside entitlement.mjs's
 * PLANS list as the single source of truth for pricing; 'basic' is free and
 * has no Razorpay plan.
 *
 * These are only used by scripts/setup-razorpay-plans.mjs to CREATE the
 * Razorpay Plan objects once — changing a price here later does NOT change
 * an already-created Plan or any subscription already running on it (that's
 * how Razorpay Plans work: immutable once created). To change a live price,
 * create a new Plan via the script, update RAZORPAY_PLAN_ID_* accordingly,
 * and existing subscribers keep their original price until they resubscribe.
 */
export const PAID_PLAN_PRICING = {
  plus: { amountPaise: 100 * 100, label: 'Plus' },
  live: { amountPaise: 200 * 100, label: 'Live' },
};

/** Maps a plan name to its Razorpay Plan ID, read from env (set post-setup-script). */
export function planIdFor(plan) {
  if (plan === 'plus') return process.env.RAZORPAY_PLAN_ID_PLUS;
  if (plan === 'live') return process.env.RAZORPAY_PLAN_ID_LIVE;
  return null;
}

/**
 * Verifies the signature Razorpay Checkout returns after a subscription
 * payment succeeds (razorpay_payment_id + razorpay_subscription_id +
 * razorpay_signature). Formula per Razorpay's subscription-checkout docs:
 * HMAC-SHA256(payment_id + "|" + subscription_id, key_secret).
 *
 * This is NOT the same formula as one-time-order checkout (which HMACs
 * order_id + "|" + payment_id) — subscriptions swap in subscription_id.
 */
export function verifySubscriptionPaymentSignature({ paymentId, subscriptionId, signature }) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');
  return expected === signature;
}

/**
 * Verifies an inbound webhook's X-Razorpay-Signature header: HMAC-SHA256 over
 * the RAW request body (not the parsed/re-stringified object — re-serializing
 * JSON can reorder keys or change whitespace and silently break the match),
 * keyed with the webhook secret configured in the Razorpay Dashboard (NOT the
 * API key_secret — a separate value).
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  // Constant-time compare — this is a security boundary (an unauthenticated
  // endpoint), not just a data-integrity check.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
