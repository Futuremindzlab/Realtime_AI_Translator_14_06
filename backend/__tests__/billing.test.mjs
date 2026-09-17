import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Same placeholder-env pattern as razorpay.test.mjs — razorpay.mjs
// constructs a live client at import time from these.
process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const { verifySubscriptionPayment, getMyBillingHistory } = await import('../src/handlers/billing.mjs');
const { db } = await import('../src/db.mjs');
const { razorpay } = await import('../src/lib/razorpay.mjs');

function fakeEvent(userId, body) {
  return {
    requestContext: { authorizer: { claims: { sub: userId } } },
    body: JSON.stringify(body),
  };
}

describe('verifySubscriptionPayment — applySubscriptionState DynamoDB call', () => {
  test('writes plan via an aliased #plan attribute name, not the bare reserved word', async (t) => {
    // 'plan' is a DynamoDB reserved keyword — an UpdateExpression using it
    // bare fails at request time with "Invalid UpdateExpression: Attribute
    // name is a reserved word", on every real payment, with no automatic
    // recovery (the webhook hits the identical bug, since both share
    // applySubscriptionState). This test pins the fix: the actual
    // UpdateCommand sent to DynamoDB must alias it via
    // ExpressionAttributeNames and reference #plan, never bare `plan`, in
    // the UpdateExpression string.
    const userId = 'user_abc123';
    const subscriptionId = 'sub_XYZ789';
    const paymentId = 'pay_DEF456';
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${paymentId}|${subscriptionId}`)
      .digest('hex');

    t.mock.method(razorpay.subscriptions, 'fetch', async () => ({
      notes: { user_id: userId, plan: 'plus' },
    }));

    let capturedCommand;
    t.mock.method(db, 'send', async (command) => {
      capturedCommand = command;
      return { Attributes: { user_id: userId, plan: 'plus' } };
    });

    const event = fakeEvent(userId, {
      razorpay_payment_id: paymentId,
      razorpay_subscription_id: subscriptionId,
      razorpay_signature: signature,
    });

    const response = await verifySubscriptionPayment(event);

    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
    assert.ok(capturedCommand, 'db.send should have been called');

    const { UpdateExpression, ExpressionAttributeNames } = capturedCommand.input;
    assert.equal(ExpressionAttributeNames?.['#plan'], 'plan');
    assert.match(UpdateExpression, /#plan/);
    // The specific bug this guards: a bare, unaliased `plan` token in the
    // expression (word-boundary match so `#plan`/`razorpay_subscription...`
    // don't false-positive).
    assert.doesNotMatch(UpdateExpression, /(?<![#\w])plan(?!\w)/);
  });
});

describe('getMyBillingHistory — self-serve payment history', () => {
  test('only returns payments whose notes.user_id matches the caller, never another user\'s', async (t) => {
    t.mock.method(razorpay.payments, 'all', async () => ({
      items: [
        { id: 'pay_mine', amount: 10000, currency: 'INR', status: 'captured', method: 'upi', notes: { user_id: 'user_abc123', plan: 'plus' }, created_at: 1700000000 },
        { id: 'pay_other', amount: 20000, currency: 'INR', status: 'captured', method: 'card', notes: { user_id: 'user_other', plan: 'live' }, created_at: 1700000100 },
      ],
    }));

    const response = await getMyBillingHistory(fakeEvent('user_abc123', {}));
    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);

    const body = JSON.parse(response.body);
    assert.equal(body.available, true);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].id, 'pay_mine');
    assert.equal(body.items[0].amount, 100); // paise → rupees
  });

  test('rejects an unauthenticated caller with 401, not an empty list', async (t) => {
    t.mock.method(razorpay.payments, 'all', async () => {
      throw new Error('should not be called without auth');
    });

    const response = await getMyBillingHistory({ requestContext: {} });
    assert.equal(response.statusCode, 401);
  });

  test('degrades to available:false instead of failing when Razorpay is unreachable', async (t) => {
    t.mock.method(razorpay.payments, 'all', async () => {
      throw new Error('ECONNREFUSED');
    });

    const response = await getMyBillingHistory(fakeEvent('user_abc123', {}));
    assert.equal(response.statusCode, 200, `expected a degraded success, got: ${response.body}`);

    const body = JSON.parse(response.body);
    assert.equal(body.available, false);
    assert.deepEqual(body.items, []);
  });
});
