/**
 * Google Play Billing subscription purchase flow — the only file that
 * touches the native `expo-iap` module, same separation-of-concerns as
 * ttsService.ts/dynamoService.ts already use for their own external SDKs.
 *
 * Replaces the earlier in-app Razorpay checkout (see git history /
 * RAZORPAY_INTEGRATION.md): Google Play policy requires apps selling
 * digital subscriptions consumed inside the app to sell them through
 * Google's own billing system, not a third-party payment processor opened
 * in-app. Razorpay's backend code (backend/src/handlers/billing.mjs) is
 * left in place for any in-flight subscriptions and billing history, but
 * nothing in the client calls it to start a NEW purchase anymore.
 *
 * expo-iap ships native code, so after adding it to package.json this app
 * needs a native rebuild before it'll work:
 *   npx expo prebuild
 *   npx expo run:android   (or an EAS build)
 * It will NOT work inside plain Expo Go.
 *
 * Flow (see backend/src/handlers/googlePlayBilling.mjs for the server side,
 * and GOOGLE_PLAY_BILLING_INTEGRATION.md for the one-time Play Console/GCP
 * setup this depends on):
 *   1. Fetch the subscription product from Play (for its current offer token).
 *   2. Call requestPurchase() and wait for the result via
 *      purchaseUpdatedListener/purchaseErrorListener — Play Billing's
 *      request/response is event-based, not a direct return value (unlike
 *      Razorpay Checkout's promise-based API).
 *   3. Ask the backend to verify the purchase (re-reads it from Google,
 *      never trusts the client) and apply the plan.
 *   4. finishTransaction() — REQUIRED within 3 days or Google auto-refunds
 *      the purchase and revokes it; the backend also acknowledges
 *      server-side as a backstop (see googlePlay.mjs), but this is the
 *      primary path.
 * Renewals, grace periods and cancellations happen entirely server-side via
 * Google's Real-time Developer Notifications and never go through this file.
 *
 * API usage below is verified directly against the installed expo-iap
 * package's shipped type definitions and JSDoc (node_modules/expo-iap —
 * v6.1.1 at the time this was written), not just its README, since this is
 * payment-critical code and the library's public docs/community examples
 * disagree in places (e.g. whether an Android subscriptionOffers entry is
 * required — it is, confirmed via node_modules/expo-iap/build/types.d.ts's
 * AndroidSubscriptionOfferInput/RequestSubscriptionAndroidProps). Still,
 * this has NOT been run against a real Play Console product yet — the
 * actual proof is a real-device purchase against an Internal Testing track
 * release, not this review. Treat the first real test as the real review.
 */
import Constants from 'expo-constants';
import {
  initConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  deepLinkToSubscriptions,
  purchaseUpdatedListener,
  purchaseErrorListener,
  isUserCancelledError,
} from 'expo-iap';
import type { Purchase, ProductSubscriptionAndroid } from 'expo-iap';
import { dynamoService } from '@/services/dynamoService';
import { PLAY_PRODUCT_ID } from '@/lib/plans';
import { UserSettings } from '@/types';

export class CheckoutCancelledError extends Error {
  constructor(message = 'Payment was cancelled') {
    super(message);
    this.name = 'CheckoutCancelledError';
  }
}

const ANDROID_PACKAGE_NAME: string = Constants.expoConfig?.android?.package || 'com.mohan.aitranslator';

// expo-iap's own guidance (hyochan/expo-iap's AGENTS.md, bundled in
// node_modules): initConnection() once per app session; mounted consumers
// share one store connection. This module isn't a React hook, so it can't
// rely on useIAP's automatic connect-on-mount — this tracks it manually,
// same idea as react-native-razorpay's checkoutInProgress guard below.
let connectionReady: Promise<void> | null = null;
function ensureConnected(): Promise<void> {
  if (!connectionReady) {
    connectionReady = initConnection()
      .then(() => undefined)
      .catch((err) => {
        connectionReady = null; // allow retry on the next call
        throw err;
      });
  }
  return connectionReady;
}

// Synchronous module-level guard against a double-tap launching two
// purchase flows at once — same reasoning as the Razorpay version's
// checkoutInProgress (React state isn't guaranteed to apply before a fast
// second onPress fires).
let purchaseInProgress = false;

/**
 * Runs the full subscribe flow for one plan and returns the updated
 * settings on success. Throws CheckoutCancelledError if the user backs out
 * of the Play purchase sheet (expected/benign — callers should not show an
 * error alert for this case), or a plain Error for anything else.
 */
export async function subscribeToPlan(plan: 'plus' | 'live'): Promise<UserSettings> {
  if (purchaseInProgress) {
    throw new CheckoutCancelledError('A payment is already in progress — please wait for it to finish.');
  }
  purchaseInProgress = true;

  try {
    await ensureConnected();

    const productId = PLAY_PRODUCT_ID[plan];
    const products = (await fetchProducts({ skus: [productId], type: 'subs' })) as ProductSubscriptionAndroid[];
    const product = products.find((p) => p.id === productId);
    if (!product) {
      throw new Error(`Plan '${plan}' isn't available for purchase right now — please try again later.`);
    }
    const offerToken = product.subscriptionOffers?.[0]?.offerTokenAndroid;
    if (!offerToken) {
      throw new Error(`Plan '${plan}' has no purchasable offer configured in Play Console yet.`);
    }

    const purchase = await new Promise<Purchase>((resolve, reject) => {
      const updateSub = purchaseUpdatedListener((p) => {
        updateSub.remove();
        errorSub.remove();
        resolve(p);
      });
      const errorSub = purchaseErrorListener((error) => {
        updateSub.remove();
        errorSub.remove();
        if (isUserCancelledError(error)) {
          reject(new CheckoutCancelledError());
        } else {
          reject(new Error(error.message || 'Payment failed — please try again.'));
        }
      });

      requestPurchase({
        type: 'subs',
        request: {
          google: {
            skus: [productId],
            subscriptionOffers: [{ sku: productId, offerToken }],
          },
        },
      }).catch((err) => {
        updateSub.remove();
        errorSub.remove();
        reject(err instanceof Error ? err : new Error('Payment failed — please try again.'));
      });
    });

    if (!purchase.purchaseToken) {
      throw new Error('Purchase did not return a valid token — please try again, or check Settings in a few minutes.');
    }

    const updated = await dynamoService.verifyGooglePlayPurchase({
      product_id: productId,
      purchase_token: purchase.purchaseToken,
    });

    // Required within 3 days or Google auto-refunds (see module doc comment).
    // Runs after the backend has already applied the plan, so a failure
    // here doesn't lose the purchase — the backend's own acknowledge call
    // (googlePlay.mjs) is the backstop if this one never completes (app
    // killed, etc.).
    await finishTransaction({ purchase, isConsumable: false }).catch((err) => {
      console.error('⚠️ finishTransaction failed (backend already acknowledged as backstop):', err);
    });

    return updated;
  } finally {
    purchaseInProgress = false;
  }
}

/**
 * Opens Play Store's own subscription-management page for this plan —
 * Google Play Billing has no in-app "cancel" API call (unlike Razorpay);
 * subscription management is Google's own UI by design, and that's also
 * the standard pattern for Play Store apps generally. The actual plan
 * downgrade happens server-side via Google's Real-time Developer
 * Notifications once the user cancels there — refreshSettings() after the
 * user returns to the app won't show it immediately, same lag as the old
 * Razorpay cancel-at-cycle-end behavior.
 */
export async function openSubscriptionManagement(plan: 'plus' | 'live'): Promise<void> {
  await deepLinkToSubscriptions({
    skuAndroid: PLAY_PRODUCT_ID[plan],
    packageNameAndroid: ANDROID_PACKAGE_NAME,
  });
}
