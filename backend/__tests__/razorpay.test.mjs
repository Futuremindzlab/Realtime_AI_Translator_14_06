import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// razorpay.mjs constructs a live Razorpay client at import time from
// RAZORPAY_KEY_ID/SECRET — set placeholders before importing so that
// doesn't throw, matching how the Lambda itself only ever runs with these
// set (see backend/template.yaml's RazorpayKeyId/Secret parameters).
process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const {
  PAID_PLAN_PRICING,
  verifySubscriptionPaymentSignature,
  verifyWebhookSignature,
} = await import('../src/lib/razorpay.mjs');

describe('PAID_PLAN_PRICING', () => {
  test('matches the price this session most recently agreed on (₹100 / ₹200)', () => {
    // Same literal the app-side __tests__/plans.test.ts pins for
    // lib/plans.ts's PAID_PLAN_PRICE — these two files are a deliberate
    // duplication (see this file's own header comment for why), so nothing
    // else catches them drifting apart. If this test and the app-side one
    // ever disagree, the paywall and the actual charge disagree too.
    assert.deepEqual(PAID_PLAN_PRICING, {
      plus: { amountPaise: 10000, label: 'Plus' },
      live: { amountPaise: 20000, label: 'Live' },
    });
  });

  test('prices are in whole rupees (no fractional paise)', () => {
    for (const { amountPaise } of Object.values(PAID_PLAN_PRICING)) {
      assert.equal(amountPaise % 100, 0);
    }
  });
});

describe('verifySubscriptionPaymentSignature', () => {
  test('accepts a correctly-signed payment', () => {
    const paymentId = 'pay_ABC123';
    const subscriptionId = 'sub_XYZ789';
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${paymentId}|${subscriptionId}`)
      .digest('hex');

    assert.equal(
      verifySubscriptionPaymentSignature({ paymentId, subscriptionId, signature }),
      true
    );
  });

  test('rejects a tampered signature', () => {
    assert.equal(
      verifySubscriptionPaymentSignature({
        paymentId: 'pay_ABC123',
        subscriptionId: 'sub_XYZ789',
        signature: 'not-even-hex',
      }),
      false
    );
  });

  test('rejects a signature computed for a different payment/subscription pair', () => {
    // Guards against a signature from one checkout being replayed against a
    // different subscription_id — the exact class of bug this HMAC exists
    // to prevent.
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update('pay_ABC123|sub_XYZ789')
      .digest('hex');

    assert.equal(
      verifySubscriptionPaymentSignature({
        paymentId: 'pay_ABC123',
        subscriptionId: 'sub_DIFFERENT',
        signature,
      }),
      false
    );
  });

  test('rejects a signature signed with the wrong secret', () => {
    const signature = crypto
      .createHmac('sha256', 'wrong_secret')
      .update('pay_ABC123|sub_XYZ789')
      .digest('hex');

    assert.equal(
      verifySubscriptionPaymentSignature({
        paymentId: 'pay_ABC123',
        subscriptionId: 'sub_XYZ789',
        signature,
      }),
      false
    );
  });
});

describe('verifyWebhookSignature', () => {
  test('accepts a correctly-signed raw body', () => {
    const rawBody = JSON.stringify({ event: 'subscription.charged', payload: {} });
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    assert.equal(verifyWebhookSignature(rawBody, signature), true);
  });

  test('rejects a body that was re-serialized after signing (the exact bug the raw-body requirement guards against)', () => {
    const original = { event: 'subscription.charged', payload: {} };
    const rawBody = JSON.stringify(original);
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    // Same object, re-stringified — whitespace/key-order can differ even
    // with identical data, which is exactly why the handler must sign the
    // untouched raw body rather than JSON.stringify(JSON.parse(rawBody)).
    const reserialized = JSON.stringify(JSON.parse(rawBody), null, 0) + ' ';
    assert.equal(verifyWebhookSignature(reserialized, signature), false);
  });

  test('rejects a missing signature header', () => {
    assert.equal(verifyWebhookSignature('{}', undefined), false);
    assert.equal(verifyWebhookSignature('{}', ''), false);
  });

  test('rejects a signature of the wrong length without throwing', () => {
    // verifyWebhookSignature uses crypto.timingSafeEqual, which throws on
    // mismatched buffer lengths if not guarded — a malicious or malformed
    // header one byte short/long must be rejected, not crash the handler.
    assert.doesNotThrow(() => verifyWebhookSignature('{}', 'short'));
    assert.equal(verifyWebhookSignature('{}', 'short'), false);
  });
});
