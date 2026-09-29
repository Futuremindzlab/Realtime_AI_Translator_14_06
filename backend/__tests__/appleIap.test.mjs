import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// appleIap.mjs imports @apple/app-store-server-library at module scope but,
// unlike razorpay.mjs, doesn't construct anything client-like at import time
// (SignedDataVerifier is built lazily, only once APPLE_BUNDLE_ID is actually
// used) — so no placeholder env vars are required just to import it safely.
process.env.APPLE_PRODUCT_ID_PLUS = 'com.example.app.plus.monthly';
process.env.APPLE_PRODUCT_ID_LIVE = 'com.example.app.live.monthly';

const { productIdFor, planForProductId } = await import('../src/lib/appleIap.mjs');

// NOTE on coverage: verifyAndDecodeTransaction/verifyAndDecodeNotification
// (the actual signature/x5c-chain verification — the security-critical
// part) are NOT covered here. Exercising them for real needs an
// Apple-signed JWS fixture (only obtainable from a real Sandbox purchase or
// Apple's own test fixtures) plus network access to fetch Apple's root CA,
// neither available in this sandboxed environment (this environment's
// egress policy blocks apple.com — see appleIap.mjs's file-level comment).
// What's tested below is the part that's pure, deterministic, and where a
// mistake would have real consequences: which plan a given App Store
// product ID actually grants.

describe('productIdFor / planForProductId', () => {
  test('productIdFor returns the configured product ID for each paid plan', () => {
    assert.equal(productIdFor('plus'), 'com.example.app.plus.monthly');
    assert.equal(productIdFor('live'), 'com.example.app.live.monthly');
  });

  test('productIdFor returns null for an unknown/free plan', () => {
    assert.equal(productIdFor('basic'), null);
    assert.equal(productIdFor('nonsense'), null);
  });

  test('planForProductId is the exact inverse of productIdFor for both paid plans', () => {
    assert.equal(planForProductId(productIdFor('plus')), 'plus');
    assert.equal(planForProductId(productIdFor('live')), 'live');
  });

  test('planForProductId rejects a product ID that does not match either configured plan', () => {
    // The exact case that matters most: a transaction whose productId isn't
    // one of ours must NOT silently map to a plan — extractSubscriptionFields
    // in billing.mjs relies on this returning null so it can reject instead.
    assert.equal(planForProductId('com.someoneelse.app.unrelated'), null);
  });

  test('planForProductId rejects undefined/empty productId without throwing', () => {
    assert.equal(planForProductId(undefined), null);
    assert.equal(planForProductId(''), null);
  });

  test('plus and live product IDs are configured to different values', () => {
    // If these ever accidentally matched (e.g. both left blank / both set to
    // the same placeholder), planForProductId would map either purchase to
    // whichever plan happens to be checked first — a real
    // wrong-tier-granted-for-money bug, not just a test artifact.
    assert.notEqual(productIdFor('plus'), productIdFor('live'));
  });
});
