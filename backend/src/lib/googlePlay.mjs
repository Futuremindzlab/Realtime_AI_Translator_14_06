import { JWT, OAuth2Client } from 'google-auth-library';

/**
 * Hand-rolled Google Play Billing verification — no RevenueCat/third-party
 * wrapper (explicit product decision: avoid an ongoing revenue-share fee on
 * a pre-revenue app; see the PR description for the alternatives considered).
 *
 * Mirrors backend/src/lib/razorpay.mjs's shape: a singleton authenticated
 * client, a plan↔product-id mapping, and verification helpers used by both
 * the fast post-purchase confirm path and the durable RTDN webhook — same
 * "client never dictates truth, server always re-reads from the provider"
 * principle Razorpay's verify/webhook handlers already follow.
 *
 * GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL / GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY
 * come from backend/template.yaml (GooglePlayServiceAccountClientEmail /
 * GooglePlayServiceAccountPrivateKey parameters) — see
 * GOOGLE_PLAY_BILLING_INTEGRATION.md for how to create this service account
 * and link it to the Play Console app with "View financial data" access.
 */
const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

// Lazily constructed — tests and any route that never touches billing
// shouldn't fail at import time just because the env vars aren't set yet.
let _jwtClient = null;
function jwtClient() {
  if (_jwtClient) return _jwtClient;
  const email = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  // Private keys are stored with literal "\n" (SAM/CloudFormation parameters
  // can't hold real newlines) — un-escape before handing to the JWT signer,
  // same treatment multi-line PEM secrets always need in Lambda env vars.
  const key = (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw Object.assign(new Error('Google Play billing is not configured (GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL/_PRIVATE_KEY missing)'), { statusCode: 500 });
  }
  _jwtClient = new JWT({ email, key, scopes: [ANDROID_PUBLISHER_SCOPE] });
  return _jwtClient;
}

/** Maps a plan name to its Play Console subscription product ID, read from env. */
export function productIdFor(plan) {
  if (plan === 'plus') return process.env.GOOGLE_PLAY_PRODUCT_ID_PLUS;
  if (plan === 'live') return process.env.GOOGLE_PLAY_PRODUCT_ID_LIVE;
  return null;
}

/** Reverse of productIdFor — used when a webhook/verify call only has the
 *  product id (from Google) and needs to know which of our plans it is. */
export function planForProductId(productId) {
  if (productId && productId === process.env.GOOGLE_PLAY_PRODUCT_ID_PLUS) return 'plus';
  if (productId && productId === process.env.GOOGLE_PLAY_PRODUCT_ID_LIVE) return 'live';
  return null;
}

/**
 * The three functions below are grouped into the `googlePlayClient` object
 * export at the bottom of this file, not exported individually — same
 * reasoning as razorpay.mjs exporting a single `razorpay` client object:
 * backend/__tests__/googlePlayBilling.test.mjs needs to mock them, and
 * Node's ES module namespace objects are spec-frozen (can't redefine a
 * plain named export), while a plain object's own properties can be
 * mocked normally with node:test's t.mock.method. The pure/sync helpers
 * below (no I/O, nothing to mock) stay as plain named exports.
 *
 * Fetches the authoritative subscription state for a purchase token via the
 * Google Play Developer API's purchases.subscriptionsv2.get (the current,
 * non-deprecated endpoint — purchases.subscriptions.get is its deprecated
 * predecessor). Used both right after a purchase (fast-confirm path) AND on
 * every RTDN webhook delivery: we deliberately never trust the notification
 * payload's own claims about what changed, only its signal that *something*
 * changed for this token — same as Razorpay's webhook re-fetching the
 * subscription from Razorpay rather than trusting the payload.
 *
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
 */
async function fetchSubscriptionPurchase(purchaseToken) {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  if (!packageName) {
    throw Object.assign(new Error('GOOGLE_PLAY_PACKAGE_NAME is not configured'), { statusCode: 500 });
  }
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await jwtClient().request({ url, method: 'GET' });
  return res.data; // SubscriptionPurchaseV2
}

/**
 * Acknowledges a subscription purchase — REQUIRED within 3 days of purchase
 * or Google automatically refunds it and revokes access (this is the single
 * most common hand-rolled-Play-Billing bug: verifying a purchase is not the
 * same as acknowledging it). expo-iap's finishTransaction() also triggers
 * acknowledgement client-side, so this call is expected to often no-op
 * against an already-acknowledged purchase (Google returns an error for
 * that, which callers here should swallow, not treat as a failure) — it
 * exists so acknowledgement doesn't depend on the client's finishTransaction
 * call actually reaching Google (app killed mid-flow, etc.), making the
 * server the durable backstop the same way the RTDN webhook is the durable
 * backstop for plan state generally.
 *
 * subscriptionId in the path is the product id the purchase was for —
 * Google's docs note this became an optional path segment in 2025, but
 * every documented example still passes it, so we do too.
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge
 */
async function acknowledgeSubscriptionPurchase(productId, purchaseToken) {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  try {
    await jwtClient().request({ url, method: 'POST', data: {} });
  } catch (err) {
    // Google returns 400 for an already-acknowledged purchase — not an error
    // for our purposes (see doc comment above).
    const status = err?.response?.status;
    if (status !== 400) throw err;
  }
}

/**
 * Entitlement states where the user should keep paid access. Deliberately
 * includes the grace period (payment is late/retrying but Google itself
 * recommends not cutting access yet) — everything else (on hold, canceled,
 * expired, pending) downgrades to 'basic', matching how billing.mjs's
 * Razorpay webhook treats 'halted'/'cancelled'/'completed'/'paused'.
 * https://developer.android.com/google/play/billing/subscriptions#lifecycle
 */
const ACTIVE_SUBSCRIPTION_STATES = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD']);

export function isActiveSubscriptionState(subscriptionState) {
  return ACTIVE_SUBSCRIPTION_STATES.has(subscriptionState);
}

/**
 * Verifies a Pub/Sub push request's OIDC identity token (Google Cloud's
 * "authenticated push subscriptions" feature — see
 * GOOGLE_PLAY_BILLING_INTEGRATION.md for how the Pub/Sub subscription is
 * configured to send this). This is the RTDN webhook's equivalent of
 * Razorpay's X-Razorpay-Signature check: an unauthenticated-by-API-Gateway
 * endpoint (Google's servers call it directly, no Cognito token) that must
 * still prove the request actually came from our own Pub/Sub subscription,
 * not an attacker who guessed the URL and POSTed a fake "subscription
 * cancelled" notification to downgrade someone's plan for free, or a fake
 * "active" one to grant free access.
 *
 * Checks: the token is a validly-signed Google ID token, its audience
 * matches this exact endpoint URL (GOOGLE_PLAY_RTDN_AUDIENCE), and its
 * subject is the specific service account the Pub/Sub push subscription
 * authenticates as (GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL — the same account
 * used for API calls above; Pub/Sub is granted
 * roles/iam.serviceAccountTokenCreator on it to mint these tokens).
 */
async function verifyRtdnPushToken(authorizationHeader) {
  const expectedAudience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  const expectedEmail = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  if (!expectedAudience || !expectedEmail) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader || '');
  if (!match) return false;

  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({ idToken: match[1], audience: expectedAudience });
    const payload = ticket.getPayload();
    return Boolean(payload && payload.email === expectedEmail && payload.email_verified);
  } catch {
    return false;
  }
}

/**
 * Decodes an RTDN Pub/Sub push HTTP body into the DeveloperNotification JSON
 * Google wraps base64 inside `message.data`. Deliberately does NOT try to
 * interpret `subscriptionNotification.notificationType` — every notification
 * is treated purely as "something changed for this token, go re-fetch the
 * truth" (see fetchSubscriptionPurchase's doc comment), which sidesteps
 * needing to keep a ~15-value enum in sync with Google's docs by hand.
 * https://developer.android.com/google/play/billing/rtdn-reference
 */
export function decodeRtdnPushBody(rawBody) {
  const body = JSON.parse(rawBody);
  const dataB64 = body?.message?.data;
  if (!dataB64) return null;
  return JSON.parse(Buffer.from(dataB64, 'base64').toString('utf8'));
}

/** See the doc comment above fetchSubscriptionPurchase for why these three
 *  are grouped into one mockable object instead of individual exports. */
export const googlePlayClient = {
  fetchSubscriptionPurchase,
  acknowledgeSubscriptionPurchase,
  verifyRtdnPushToken,
};
