import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, SETTINGS_TABLE, GOOGLE_PLAY_PURCHASES_TABLE } from '../db.mjs';
import { getUserId } from '../auth.mjs';
import { sendSuccess, sendError, handleError } from '../response.mjs';
import {
  googlePlayClient,
  planForProductId,
  isActiveSubscriptionState,
  decodeRtdnPushBody,
} from '../lib/googlePlay.mjs';

/**
 * Writes plan + subscription bookkeeping to a user's settings record —
 * google_play_* counterpart to billing.mjs's applySubscriptionState.
 */
async function applyPlanState(userId, { plan, productId, purchaseToken, subscriptionState }) {
  const result = await db.send(new UpdateCommand({
    TableName: SETTINGS_TABLE,
    Key: { user_id: userId },
    // 'plan' is a DynamoDB reserved word — see billing.mjs's identical comment.
    UpdateExpression: 'SET #plan = :p, google_play_product_id = :pid, google_play_purchase_token = :tok, google_play_subscription_state = :st, updated_at = :u',
    ExpressionAttributeNames: { '#plan': 'plan' },
    ExpressionAttributeValues: {
      ':p': plan,
      ':pid': productId,
      ':tok': purchaseToken,
      ':st': subscriptionState,
      ':u': new Date().toISOString(),
    },
    ReturnValues: 'ALL_NEW',
  }));
  return result.Attributes;
}

/**
 * Claims a purchase token for a user_id, atomically and exactly once.
 *
 * Unlike Razorpay (where createSubscription embeds user_id into the
 * subscription BEFORE checkout, so verify/webhook can read identity back
 * from Razorpay's own record), Google Play Billing has no server-side
 * "create" step — the client starts a purchase directly against the Play
 * Store with nothing but a product id. Without this guard, anyone who got
 * hold of any valid purchase token (their own from a previous account,
 * one observed in a log, a stale token from a refunded purchase, etc.)
 * could call /verify as a DIFFERENT authenticated user and claim the paid
 * plan for free — the token itself is the only proof of purchase, so
 * whoever submits it first server-side has to be the one it sticks to.
 *
 * The conditional PutCommand makes "first verify call for this token wins"
 * atomic even under a race (e.g. a retried request). A second verify call
 * for the SAME token by the SAME user (app restart, network retry) is a
 * legitimate no-op, not a conflict — only a different user_id is rejected.
 */
async function claimPurchaseToken(purchaseToken, userId) {
  try {
    await db.send(new PutCommand({
      TableName: GOOGLE_PLAY_PURCHASES_TABLE,
      Item: { purchase_token: purchaseToken, user_id: userId, claimed_at: new Date().toISOString() },
      ConditionExpression: 'attribute_not_exists(purchase_token)',
    }));
    return true;
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
    const existing = await db.send(new GetCommand({ TableName: GOOGLE_PLAY_PURCHASES_TABLE, Key: { purchase_token: purchaseToken } }));
    return existing.Item?.user_id === userId;
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/billing/google-play/verify
// Body: { product_id, purchase_token }
//
// Fast, in-app confirmation right after a Play Billing purchase succeeds —
// the RTDN webhook below is the durable source of truth (covers the app
// being killed right after purchase, and every future renewal, which never
// goes through this call) — this just makes the UI update immediately and
// acknowledges the purchase so Google doesn't auto-refund it.
// ─────────────────────────────────────────────────────────
export async function verifyPurchase(event) {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const { product_id: productId, purchase_token: purchaseToken } = body;

    if (!productId || !purchaseToken) {
      return sendError(400, 'product_id and purchase_token are required');
    }

    const plan = planForProductId(productId);
    if (!plan) {
      return sendError(400, `Unrecognized product_id: ${productId}`);
    }

    const owns = await claimPurchaseToken(purchaseToken, userId);
    if (!owns) {
      return sendError(403, 'This purchase token is already linked to a different account');
    }

    // Never trust the client's claim that it paid — re-read the purchase
    // from Google itself, same principle as Razorpay's verify handler
    // re-fetching the subscription rather than trusting the client.
    const purchase = await googlePlayClient.fetchSubscriptionPurchase(purchaseToken);
    const lineItemProductId = purchase?.lineItems?.[0]?.productId;
    if (lineItemProductId !== productId) {
      return sendError(400, 'purchase_token does not match product_id');
    }

    await googlePlayClient.acknowledgeSubscriptionPurchase(productId, purchaseToken).catch((err) => {
      // Don't fail the whole request over acknowledgement — the RTDN
      // webhook path and expo-iap's own client-side finishTransaction are
      // both backstops for this; log and continue so the user still sees
      // their plan update.
      console.error('⚠️ Google Play acknowledge failed (non-fatal):', err?.message || err);
    });

    if (!isActiveSubscriptionState(purchase?.subscriptionState)) {
      return sendError(400, `Purchase is not in an active state (${purchase?.subscriptionState || 'unknown'})`);
    }

    const updated = await applyPlanState(userId, {
      plan,
      productId,
      purchaseToken,
      subscriptionState: purchase.subscriptionState,
    });
    return sendSuccess(updated);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/billing/google-play/rtdn  (UNAUTHENTICATED by API Gateway — see
// template.yaml; Google Cloud Pub/Sub calls this directly, there's no
// Cognito token. Authenticity is checked via the push subscription's own
// OIDC token instead — see googlePlay.mjs's verifyRtdnPushToken.)
//
// The durable source of truth for subscription state: covers renewals,
// grace periods, account holds, and cancellations, none of which the client
// is ever present for. Deliberately ignores the notification payload's own
// claims and just re-fetches the purchase's current truth from Google —
// see fetchSubscriptionPurchase's doc comment for why.
// ─────────────────────────────────────────────────────────
export async function handleRtdn(event) {
  try {
    const headerKey = Object.keys(event.headers || {}).find((k) => k.toLowerCase() === 'authorization');
    const authHeader = headerKey ? event.headers[headerKey] : undefined;

    if (!(await googlePlayClient.verifyRtdnPushToken(authHeader))) {
      console.error('❌ Google Play RTDN push token verification failed — rejecting');
      return sendError(401, 'Invalid push authentication');
    }

    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    const notification = decodeRtdnPushBody(rawBody);

    // testNotification (sent when you click "Publish test notification" in
    // Play Console while wiring this up) and voidedPurchaseNotification
    // (refund/chargeback — no subscriptionNotification.purchaseToken to act
    // on here; the next natural RTDN for the token, or its absence, handles
    // the downgrade) both have nothing for us to look up — acknowledge and move on.
    const purchaseToken = notification?.subscriptionNotification?.purchaseToken;
    if (!purchaseToken) {
      console.log('ℹ️ Google Play RTDN had no subscription purchase token — ignoring', notification?.testNotification ? '(test notification)' : '');
      return sendSuccess({ received: true });
    }

    // Pub/Sub push requires a 2xx within its ack deadline or it retries —
    // the claim record is what tells us who this token belongs to; if
    // nothing ever claimed it (e.g. the app's own /verify call never
    // reached our backend), there's no account to update yet. The retried
    // push will eventually succeed once /verify has run, so acknowledge
    // rather than error (an error here would retry forever otherwise).
    const claim = await db.send(new GetCommand({ TableName: GOOGLE_PLAY_PURCHASES_TABLE, Key: { purchase_token: purchaseToken } }));
    const userId = claim.Item?.user_id;
    if (!userId) {
      console.log(`ℹ️ Google Play RTDN for an unclaimed purchase token — ignoring for now: ${purchaseToken}`);
      return sendSuccess({ received: true });
    }

    const purchase = await googlePlayClient.fetchSubscriptionPurchase(purchaseToken);
    const productId = purchase?.lineItems?.[0]?.productId;
    const plan = isActiveSubscriptionState(purchase?.subscriptionState) ? planForProductId(productId) : 'basic';

    if (plan === 'basic') {
      await applyPlanState(userId, { plan: 'basic', productId, purchaseToken, subscriptionState: purchase?.subscriptionState });
    } else {
      await applyPlanState(userId, { plan, productId, purchaseToken, subscriptionState: purchase.subscriptionState });
    }

    console.log(`📩 Google Play RTDN applied: user ${userId} → ${plan} (${purchase?.subscriptionState})`);
    return sendSuccess({ received: true });
  } catch (err) {
    // Same reasoning as Razorpay's webhook handler: don't let an unexpected
    // payload retry forever — log and acknowledge rather than 500-loop.
    console.error('❌ Google Play RTDN handler error:', err);
    return sendSuccess({ received: true, error: 'handler_error' });
  }
}
