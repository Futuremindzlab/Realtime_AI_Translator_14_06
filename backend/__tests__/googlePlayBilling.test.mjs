import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.GOOGLE_PLAY_PACKAGE_NAME = 'com.mohan.aitranslator';
process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL = 'sa@test.iam.gserviceaccount.com';
process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY = 'fake-key-not-used-because-the-jwt-client-itself-is-never-constructed-in-these-tests';
process.env.GOOGLE_PLAY_PRODUCT_ID_PLUS = 'onelingo_plus_monthly';
process.env.GOOGLE_PLAY_PRODUCT_ID_LIVE = 'onelingo_live_monthly';
process.env.GOOGLE_PLAY_RTDN_AUDIENCE = 'https://api.example.com/v1/billing/google-play/rtdn';

const { verifyPurchase, handleRtdn } = await import('../src/handlers/googlePlayBilling.mjs');
const { db } = await import('../src/db.mjs');
const { googlePlayClient } = await import('../src/lib/googlePlay.mjs');

function fakeEvent(userId, body) {
  return {
    requestContext: { authorizer: { claims: { sub: userId } } },
    body: JSON.stringify(body),
  };
}

function conditionalCheckFailure() {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

// decodeRtdnPushBody is pure (base64 + JSON, no I/O) so tests exercise the
// real function with a realistic Pub/Sub push envelope, rather than mocking
// it — only the I/O-performing googlePlayClient methods need mocks.
function pubSubPushBody(notification) {
  const data = Buffer.from(JSON.stringify(notification)).toString('base64');
  return JSON.stringify({ message: { data, messageId: '1', publishTime: new Date().toISOString() }, subscription: 'projects/p/subscriptions/s' });
}

describe('verifyPurchase — one-time purchase-token claim', () => {
  test('first verify for a token claims it and applies the plan', async (t) => {
    const userId = 'user_abc123';
    const purchaseToken = 'tok_111';

    const dbCalls = [];
    t.mock.method(db, 'send', async (command) => {
      dbCalls.push(command.constructor.name);
      if (command.constructor.name === 'PutCommand') return {}; // claim succeeds
      if (command.constructor.name === 'UpdateCommand') return { Attributes: { user_id: userId, plan: 'plus' } };
      throw new Error(`unexpected command ${command.constructor.name}`);
    });
    t.mock.method(googlePlayClient, 'fetchSubscriptionPurchase', async () => ({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [{ productId: 'onelingo_plus_monthly' }],
    }));
    t.mock.method(googlePlayClient, 'acknowledgeSubscriptionPurchase', async () => {});

    const response = await verifyPurchase(fakeEvent(userId, { product_id: 'onelingo_plus_monthly', purchase_token: purchaseToken }));

    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
    assert.deepEqual(dbCalls, ['PutCommand', 'UpdateCommand']);
  });

  test('a second verify for the SAME token by the SAME user is allowed (retry-safe)', async (t) => {
    const userId = 'user_abc123';
    const purchaseToken = 'tok_222';

    t.mock.method(db, 'send', async (command) => {
      if (command.constructor.name === 'PutCommand') throw conditionalCheckFailure();
      if (command.constructor.name === 'GetCommand') return { Item: { purchase_token: purchaseToken, user_id: userId } };
      if (command.constructor.name === 'UpdateCommand') return { Attributes: { user_id: userId, plan: 'plus' } };
      throw new Error(`unexpected command ${command.constructor.name}`);
    });
    t.mock.method(googlePlayClient, 'fetchSubscriptionPurchase', async () => ({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [{ productId: 'onelingo_plus_monthly' }],
    }));
    t.mock.method(googlePlayClient, 'acknowledgeSubscriptionPurchase', async () => {});

    const response = await verifyPurchase(fakeEvent(userId, { product_id: 'onelingo_plus_monthly', purchase_token: purchaseToken }));

    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
  });

  test('a DIFFERENT user presenting an already-claimed token is rejected — the core anti-fraud property', async (t) => {
    const legitimateOwner = 'user_abc123';
    const attacker = 'user_evil999';
    const purchaseToken = 'tok_333';

    t.mock.method(db, 'send', async (command) => {
      if (command.constructor.name === 'PutCommand') throw conditionalCheckFailure();
      if (command.constructor.name === 'GetCommand') return { Item: { purchase_token: purchaseToken, user_id: legitimateOwner } };
      throw new Error(`unexpected command ${command.constructor.name} — verify should reject before ever reaching an UpdateCommand`);
    });

    const response = await verifyPurchase(fakeEvent(attacker, { product_id: 'onelingo_plus_monthly', purchase_token: purchaseToken }));

    assert.equal(response.statusCode, 403, `expected 403, got: ${response.body}`);
  });

  test("rejects when Google's record disagrees with the claimed product_id", async (t) => {
    const userId = 'user_abc123';
    const purchaseToken = 'tok_444';

    t.mock.method(db, 'send', async (command) => {
      if (command.constructor.name === 'PutCommand') return {};
      throw new Error(`unexpected command ${command.constructor.name}`);
    });
    t.mock.method(googlePlayClient, 'fetchSubscriptionPurchase', async () => ({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [{ productId: 'onelingo_live_monthly' }], // caller claimed 'plus'
    }));

    const response = await verifyPurchase(fakeEvent(userId, { product_id: 'onelingo_plus_monthly', purchase_token: purchaseToken }));

    assert.equal(response.statusCode, 400, `expected 400, got: ${response.body}`);
  });

  test('rejects a purchase that is not in an active/grace-period state', async (t) => {
    const userId = 'user_abc123';
    const purchaseToken = 'tok_555';

    t.mock.method(db, 'send', async (command) => {
      if (command.constructor.name === 'PutCommand') return {};
      throw new Error(`unexpected command ${command.constructor.name}`);
    });
    t.mock.method(googlePlayClient, 'fetchSubscriptionPurchase', async () => ({
      subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
      lineItems: [{ productId: 'onelingo_plus_monthly' }],
    }));
    t.mock.method(googlePlayClient, 'acknowledgeSubscriptionPurchase', async () => {});

    const response = await verifyPurchase(fakeEvent(userId, { product_id: 'onelingo_plus_monthly', purchase_token: purchaseToken }));

    assert.equal(response.statusCode, 400, `expected 400, got: ${response.body}`);
  });
});

describe('handleRtdn — push authenticity and re-fetch-don\'t-trust-payload behavior', () => {
  test('rejects a push whose OIDC token fails verification', async (t) => {
    t.mock.method(googlePlayClient, 'verifyRtdnPushToken', async () => false);

    const response = await handleRtdn({ headers: { Authorization: 'Bearer not-a-real-token' }, body: '{}' });

    assert.equal(response.statusCode, 401, `expected 401, got: ${response.body}`);
  });

  test('an authenticated notification for an unclaimed token is acknowledged without touching settings', async (t) => {
    t.mock.method(googlePlayClient, 'verifyRtdnPushToken', async () => true);

    let dbCalled = false;
    t.mock.method(db, 'send', async (command) => {
      dbCalled = true;
      if (command.constructor.name === 'GetCommand') return { Item: undefined };
      throw new Error(`unexpected command ${command.constructor.name} — an unclaimed token should never reach an UpdateCommand`);
    });

    const body = pubSubPushBody({ subscriptionNotification: { purchaseToken: 'tok_never_claimed', notificationType: 4 } });
    const response = await handleRtdn({ headers: { Authorization: 'Bearer valid' }, body });

    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
    assert.ok(dbCalled, 'should have looked up the claim');
  });

  test('re-fetches the authoritative purchase state rather than trusting the notification payload', async (t) => {
    const userId = 'user_abc123';
    const purchaseToken = 'tok_666';

    t.mock.method(googlePlayClient, 'verifyRtdnPushToken', async () => true);

    let updateExpressionValues;
    t.mock.method(db, 'send', async (command) => {
      if (command.constructor.name === 'GetCommand') return { Item: { purchase_token: purchaseToken, user_id: userId } };
      if (command.constructor.name === 'UpdateCommand') {
        updateExpressionValues = command.input.ExpressionAttributeValues;
        return { Attributes: {} };
      }
      throw new Error(`unexpected command ${command.constructor.name}`);
    });
    t.mock.method(googlePlayClient, 'fetchSubscriptionPurchase', async () => ({
      subscriptionState: 'SUBSCRIPTION_STATE_CANCELED', // the actual truth: not active
      lineItems: [{ productId: 'onelingo_plus_monthly' }],
    }));

    // A real attacker-controlled payload could claim anything here — the
    // handler must not act on notificationType at all, only on what
    // fetchSubscriptionPurchase (mocked above) reports as current truth.
    const body = pubSubPushBody({ subscriptionNotification: { purchaseToken, notificationType: 4 /* "PURCHASED", a lie */ } });
    const response = await handleRtdn({ headers: { Authorization: 'Bearer valid' }, body });

    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
    assert.equal(updateExpressionValues?.[':p'], 'basic', 'should downgrade to basic based on the re-fetched state, not the notification type');
  });
});
