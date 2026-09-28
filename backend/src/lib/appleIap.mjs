/**
 * Apple In-App Purchase verification — App Store subscriptions for 'plus'/'live',
 * the iOS counterpart to razorpay.mjs (used on Android). Built on Apple's own
 * @apple/app-store-server-library rather than hand-rolling JWS parsing/x5c
 * certificate-chain verification — that's security-critical code (it's the
 * only thing standing between a real purchase and a forged one) and Apple
 * publishes and maintains the reference implementation for exactly this.
 *
 * Sources consulted while building this (same reasoning as RAZORPAY_INTEGRATION.md —
 * verified against the library's actual TypeScript source on GitHub rather than
 * assumed from memory, since getting a payment-verification API signature wrong
 * either breaks legitimate purchases or — worse — silently accepts forged ones):
 * - https://github.com/apple/app-store-server-library-node (README + source)
 * - https://raw.githubusercontent.com/apple/app-store-server-library-node/main/jws_verification.ts
 *   (SignedDataVerifier's exact method signatures)
 * - https://raw.githubusercontent.com/apple/app-store-server-library-node/main/models/*.ts
 *   (JWSTransactionDecodedPayload / ResponseBodyV2DecodedPayload / NotificationTypeV2 / Subtype field names)
 *
 * Why no bundled root certificate file: Apple's verifier needs its Root CA
 * (AppleRootCA-G3.cer) to validate the x5c certificate chain on every signed
 * payload. This environment's egress policy blocks apple.com, so a cert file
 * committed here could not be independently verified against Apple's real
 * download — shipping an unverifiable binary into security-critical
 * verification code is worse than not having it. Fetching it once at cold
 * start (cached for the life of the warm Lambda, same singleton pattern as
 * razorpay.mjs's client) works fine in the actual deployed Lambda, which has
 * normal internet access, and never goes stale if Apple ever rotates it.
 */
import {
  SignedDataVerifier,
  Environment,
  VerificationException,
} from '@apple/app-store-server-library';

const APPLE_ROOT_CA_URL = 'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer';

/** Maps a plan name to its App Store Connect subscription product ID, read
 *  from env (set once the products exist in App Store Connect — see
 *  APPLE_IAP_INTEGRATION.md). Mirrors razorpay.mjs's planIdFor(). */
export function productIdFor(plan) {
  if (plan === 'plus') return process.env.APPLE_PRODUCT_ID_PLUS;
  if (plan === 'live') return process.env.APPLE_PRODUCT_ID_LIVE;
  return null;
}

/** Reverse of productIdFor — which plan a given App Store product ID grants.
 *  Apple's signed transaction carries productId, not an arbitrary "notes"
 *  field the way Razorpay's subscription.notes does, so this mapping (not a
 *  client-supplied claim) is the plan's source of truth. */
export function planForProductId(productId) {
  if (!productId) return null;
  if (productId === process.env.APPLE_PRODUCT_ID_PLUS) return 'plus';
  if (productId === process.env.APPLE_PRODUCT_ID_LIVE) return 'live';
  return null;
}

let rootCAPromise = null;
/** Fetches + caches Apple's Root CA G3 cert (DER bytes) for the life of this
 *  warm Lambda. See the file-level comment for why this isn't a bundled file. */
function getAppleRootCAs() {
  if (!rootCAPromise) {
    rootCAPromise = (async () => {
      const res = await fetch(APPLE_ROOT_CA_URL);
      if (!res.ok) {
        // Reset so the NEXT call retries instead of caching a permanent failure
        // for the rest of this warm Lambda's lifetime.
        rootCAPromise = null;
        throw new Error(`Failed to fetch Apple Root CA: HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return [buf];
    })();
  }
  return rootCAPromise;
}

let sandboxVerifierPromise = null;
let productionVerifierPromise = null;

/**
 * Both a real production purchase and a Sandbox/TestFlight test purchase can
 * hit this SAME webhook/verify endpoint — Apple doesn't route them
 * differently — but SignedDataVerifier is constructed for exactly one
 * Environment and rejects a payload signed for the other. Two verifiers, one
 * per environment, tried in order (see verifyTransaction/verifyNotification
 * below) is the standard way to accept both from a single endpoint.
 *
 * The Production verifier additionally requires appAppleId (the app's
 * numeric App Store Connect ID) — that only exists once the App Store
 * Connect app record has been created, so it's optional here: without
 * APPLE_APP_APPLE_ID set, only Sandbox verification works, which is exactly
 * what's needed during TestFlight-only development before the app record
 * exists yet.
 */
async function getSandboxVerifier() {
  if (!sandboxVerifierPromise) {
    sandboxVerifierPromise = (async () => {
      const bundleId = process.env.APPLE_BUNDLE_ID;
      if (!bundleId) return null;
      const rootCAs = await getAppleRootCAs();
      return new SignedDataVerifier(rootCAs, true, Environment.SANDBOX, bundleId);
    })();
  }
  return sandboxVerifierPromise;
}

async function getProductionVerifier() {
  if (!productionVerifierPromise) {
    productionVerifierPromise = (async () => {
      const bundleId = process.env.APPLE_BUNDLE_ID;
      const appAppleId = process.env.APPLE_APP_APPLE_ID;
      if (!bundleId || !appAppleId) return null;
      const rootCAs = await getAppleRootCAs();
      return new SignedDataVerifier(rootCAs, true, Environment.PRODUCTION, bundleId, Number(appAppleId));
    })();
  }
  return productionVerifierPromise;
}

/** Tries Production first (the common case once the app is live), then falls
 *  back to Sandbox (TestFlight/Xcode testing) — see the doc comment above. */
async function verifyWithBothEnvironments(decode) {
  const production = await getProductionVerifier();
  if (production) {
    try {
      return await decode(production);
    } catch (err) {
      if (!(err instanceof VerificationException)) throw err;
      // Fall through to Sandbox below.
    }
  }

  const sandbox = await getSandboxVerifier();
  if (!sandbox) {
    throw new Error('Apple IAP is not configured (APPLE_BUNDLE_ID not set) — see APPLE_IAP_INTEGRATION.md');
  }
  return decode(sandbox); // let a real VerificationException here propagate to the caller
}

/** Verifies + decodes a signed transaction (the JWS the client gets back
 *  from react-native-iap's getTransactionJwsIOS() right after a purchase).
 *  Throws VerificationException if the signature/chain doesn't check out
 *  against either environment. */
export function verifyAndDecodeTransaction(signedTransactionInfo) {
  return verifyWithBothEnvironments((verifier) => verifier.verifyAndDecodeTransaction(signedTransactionInfo));
}

/** Verifies + decodes an App Store Server Notifications V2 payload (the
 *  webhook body Apple POSTs directly — see handlers/billing.mjs). */
export function verifyAndDecodeNotification(signedPayload) {
  return verifyWithBothEnvironments((verifier) => verifier.verifyAndDecodeNotification(signedPayload));
}

export { VerificationException };
