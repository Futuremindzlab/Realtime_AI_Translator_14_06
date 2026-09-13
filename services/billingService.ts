/**
 * Razorpay subscription checkout — the only file that touches the native
 * `react-native-razorpay` module, same separation-of-concerns as
 * ttsService.ts/dynamoService.ts already use for their own external SDKs.
 *
 * react-native-razorpay ships native code, so after adding it to
 * package.json this app needs a native rebuild before it'll work:
 *   npx expo prebuild
 *   npx expo run:ios   (or run:android — or an EAS build)
 * It will NOT work inside plain Expo Go.
 *
 * Flow (see backend/src/handlers/billing.mjs for the server side):
 *   1. Ask the backend to create a Razorpay subscription for the plan.
 *   2. Open Razorpay Checkout against that subscription_id.
 *   3. On success, ask the backend to verify the payment signature and
 *      flip the user's plan — then the caller should refreshSettings().
 * Renewals and cancellations happen entirely server-side via webhook and
 * never go through this file again after the first successful checkout.
 */

import RazorpayCheckout, { CheckoutOptions } from 'react-native-razorpay';
import { dynamoService } from '@/services/dynamoService';
import { UserSettings } from '@/types';

export class CheckoutCancelledError extends Error {
  constructor(message = 'Payment was cancelled') {
    super(message);
    this.name = 'CheckoutCancelledError';
  }
}

// Razorpay's checkout promise rejects with { code, description } — description
// text for a user-initiated cancel/back-out reliably contains "cancel"
// (e.g. "Payment Processing Cancelled by user"), which is what we key off of
// rather than a numeric `code` (undocumented here and not worth hard-coding
// against without a confirmed source).
function isUserCancellation(description: unknown): boolean {
  return typeof description === 'string' && description.toLowerCase().includes('cancel');
}

// The native Android SDK throws this exact text ("Initialization issue
// between previous transaction and current transaction") when open() is
// called while it still considers a previous Checkout session live — either
// a genuine double-invocation (guarded against below via inProgress) or a
// prior session left dangling by the app being backgrounded/killed mid-
// Checkout, which the SDK can't recover from on its own. There's no
// react-native-razorpay API to force-reset that native state from JS, so the
// only thing to do is translate it into guidance instead of surfacing the
// raw SDK string.
function isStaleCheckoutSession(description: unknown): boolean {
  return typeof description === 'string' && description.toLowerCase().includes('initialization issue');
}

// Synchronous, module-level (not React state) so it can't be bypassed by a
// double-tap landing before setState/re-render disables the button — React's
// state updates aren't guaranteed to apply before a second onPress fires.
let checkoutInProgress = false;

const PLAN_LABEL: Record<'plus' | 'live', string> = { plus: 'Plus', live: 'Live' };

// The @types/react-native-razorpay CheckoutOptions interface declares
// `subscription_id`/`recurring` (good — those really are supported), but
// also marks `order_id`/`amount`/`currency` as required, which is only true
// for one-time-order Checkout, not subscription Checkout — there's no
// discriminated union between the two modes in the published types. Widening
// to Partial<CheckoutOptions> for the fields we actually pass avoids
// fabricating dummy order_id/amount/currency values just to satisfy the type.
type SubscriptionCheckoutOptions = Partial<CheckoutOptions> &
  Pick<CheckoutOptions, 'key' | 'name' | 'description' | 'theme'> & {
    subscription_id: string;
    recurring: true;
  };

// SuccessResponse (from the same types package) only declares the one-time-
// order fields (razorpay_order_id, razorpay_payment_id, razorpay_signature) —
// it's missing razorpay_subscription_id, which Razorpay's SDK does return for
// a subscription Checkout at runtime. Declared locally rather than editing
// the third-party .d.ts.
interface SubscriptionCheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

/**
 * Runs the full subscribe flow for one plan and returns the updated settings
 * on success. Throws CheckoutCancelledError if the user backs out of
 * Checkout (expected/benign — callers should not show an error alert for
 * this case), or a plain Error for anything else (network/server failure,
 * signature mismatch, etc.).
 */
export async function subscribeToPlan(plan: 'plus' | 'live'): Promise<UserSettings> {
  // Guards the same class of bug the "Initialization issue between previous
  // transaction and current transaction" native error reports: Checkout.open()
  // called a second time before the first has finished. The Settings screen
  // already disables its button while subscribing, but that's React state —
  // this check is synchronous and can't be raced by a fast double-tap landing
  // before the re-render lands.
  if (checkoutInProgress) {
    throw new CheckoutCancelledError('A payment is already in progress — please wait for it to finish.');
  }
  checkoutInProgress = true;

  try {
    const order = await dynamoService.createRazorpaySubscription(plan);

    let checkoutResult: SubscriptionCheckoutSuccess;
    try {
      const options: SubscriptionCheckoutOptions = {
        subscription_id: order.subscription_id,
        key: order.key_id,
        name: 'The OneLingo',
        description: `${PLAN_LABEL[plan]} plan — monthly subscription`,
        // Razorpay Checkout's documented flag marking this as a recurring
        // (subscription) payment sheet rather than a one-time order.
        recurring: true,
        theme: { color: '#2563eb' },
      };
      checkoutResult = (await RazorpayCheckout.open(options as CheckoutOptions)) as unknown as SubscriptionCheckoutSuccess;
    } catch (err: any) {
      if (isUserCancellation(err?.description)) {
        throw new CheckoutCancelledError();
      }
      if (isStaleCheckoutSession(err?.description)) {
        // Not something retrying immediately fixes — the native SDK's own
        // session state is stuck, most often after the app was backgrounded
        // or killed mid-Checkout last time. A full app restart clears it.
        throw new Error('Payment could not start because a previous attempt is still active. Please close and reopen the app, then try again.');
      }
      throw new Error(err?.description || 'Payment failed — please try again.');
    }

    return await dynamoService.verifyRazorpayPayment(checkoutResult);
  } finally {
    checkoutInProgress = false;
  }
}

/** Cancels the caller's active subscription (effective at cycle end — see
 *  dynamoService.cancelRazorpaySubscription's doc comment). */
export async function cancelSubscription(): Promise<UserSettings> {
  return dynamoService.cancelRazorpaySubscription();
}
