/**
 * Apple In-App Purchase (StoreKit) subscription checkout — the iOS
 * counterpart to billingService.ts's Razorpay flow (used on Android). Only
 * this file touches the native `react-native-iap` module, same
 * separation-of-concerns billingService.ts/ttsService.ts/dynamoService.ts
 * already use for their own external SDKs.
 *
 * react-native-iap ships native code, so after adding it to package.json
 * this app needs a native rebuild before it'll work:
 *   npx expo prebuild
 *   npx expo run:ios   (or an EAS build)
 * It will NOT work inside plain Expo Go.
 *
 * See APPLE_IAP_INTEGRATION.md for the full design (why appAccountToken
 * exists, why there's no cancel() here, the App Store Connect setup this
 * needs) — this file is just the client half of that.
 *
 * API verified against react-native-iap's actual TypeScript source on
 * GitHub (src/index.ts, src/types.ts) rather than assumed from memory —
 * same reasoning as backend/src/lib/appleIap.mjs's header comment.
 */
import {
  initConnection,
  requestPurchase,
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  getTransactionJwsIOS,
  showManageSubscriptionsIOS,
  ErrorCode,
  type Purchase,
} from 'react-native-iap';

export class ApplePurchaseCancelledError extends Error {
  constructor(message = 'Payment was cancelled') {
    super(message);
    this.name = 'ApplePurchaseCancelledError';
  }
}

const PRODUCT_ID: Record<'plus' | 'live', string | undefined> = {
  // Public identifiers (not secrets) — same EXPO_PUBLIC_* inlining
  // EXPO_PUBLIC_API_BASE_URL already relies on (see app.config.js).
  plus: process.env.EXPO_PUBLIC_APPLE_PRODUCT_ID_PLUS,
  live: process.env.EXPO_PUBLIC_APPLE_PRODUCT_ID_LIVE,
};

let connectionReady: Promise<void> | null = null;
function ensureConnection(): Promise<void> {
  if (!connectionReady) {
    connectionReady = initConnection().then(() => undefined);
  }
  return connectionReady;
}

// Synchronous, module-level (not React state) so a fast double-tap can't
// land a second requestPurchase() before a re-render disables the button —
// same reasoning and pattern as billingService.ts's checkoutInProgress.
let purchaseInProgress = false;

/**
 * Runs the full StoreKit purchase flow for one plan and returns the signed
 * transaction JWS the backend needs to verify it (see billingService.ts,
 * which calls dynamoService.verifyApplePurchase with this). Throws
 * ApplePurchaseCancelledError if the user backs out of the purchase sheet,
 * or a plain Error for anything else.
 *
 * `userId` is embedded as StoreKit's appAccountToken (must be a UUID —
 * Cognito's `sub` claim already is one) so the backend can trust who this
 * purchase belongs to without the client asserting it directly — see
 * APPLE_IAP_INTEGRATION.md's "Binding the purchase to a user" section.
 */
export async function subscribeToApplePlan(
  plan: 'plus' | 'live',
  userId: string,
): Promise<{ signedTransactionInfo: string; purchase: Purchase }> {
  const productId = PRODUCT_ID[plan];
  if (!productId) {
    throw new Error(
      `Apple purchases aren't configured for the '${plan}' plan yet (EXPO_PUBLIC_APPLE_PRODUCT_ID_${plan.toUpperCase()} not set).`
    );
  }
  if (purchaseInProgress) {
    throw new ApplePurchaseCancelledError('A payment is already in progress — please wait for it to finish.');
  }
  purchaseInProgress = true;

  try {
    await ensureConnection();

    const purchase = await new Promise<Purchase>((resolve, reject) => {
      // requestPurchase() below is event-based, not promise-based (its own
      // JSDoc says so) — the actual result arrives through these listeners.
      const updateSub = purchaseUpdatedListener((p) => {
        if (p.productId !== productId) return; // a different in-flight/restored purchase — not ours
        cleanup();
        resolve(p);
      });
      const errorSub = purchaseErrorListener((error) => {
        // Purchase errors aren't scoped to a specific in-flight request —
        // only react to one that either names this exact product or
        // carries no product context, so a stray unrelated failure can't
        // misattribute itself as this purchase failing.
        if (error.productId && error.productId !== productId) return;
        cleanup();
        if (error.code === ErrorCode.UserCancelled) {
          reject(new ApplePurchaseCancelledError());
        } else {
          reject(new Error(error.message || 'Payment failed — please try again.'));
        }
      });
      function cleanup() {
        updateSub.remove();
        errorSub.remove();
      }

      requestPurchase({
        type: 'subs',
        request: {
          ios: { sku: productId, appAccountToken: userId },
        },
      }).catch((err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error('Payment failed — please try again.'));
      });
    });

    const signedTransactionInfo = await getTransactionJwsIOS(productId);
    if (!signedTransactionInfo) {
      throw new Error('Could not read the completed purchase — please try again or restart the app.');
    }

    return { signedTransactionInfo, purchase };
  } finally {
    purchaseInProgress = false;
  }
}

/**
 * Tells StoreKit the transaction is fully processed. Must be called only
 * AFTER the backend has confirmed the purchase (see billingService.ts) —
 * finishing it first and having server verification fail afterward for an
 * unrelated reason (e.g. a network blip) would risk losing the purchase,
 * since a finished transaction stops being retried/re-delivered.
 */
export async function finishApplePurchase(purchase: Purchase): Promise<void> {
  await finishTransaction({ purchase, isConsumable: false });
}

/**
 * Apple provides no server API to cancel a subscription (see
 * APPLE_IAP_INTEGRATION.md) — this opens Apple's own subscription-
 * management sheet, the only way a user can actually do it. Fire-and-
 * forget: unlike Razorpay's cancelSubscription(), there is no synchronous
 * "cancelled" confirmation here — whatever the user does in that sheet
 * reaches this app later via the App Store Server Notifications webhook,
 * same as any other Apple-side subscription change.
 */
export async function openAppleManageSubscriptions(): Promise<void> {
  await ensureConnection();
  await showManageSubscriptionsIOS();
}
