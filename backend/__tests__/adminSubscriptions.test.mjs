import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';

const { getSubscriptionsOverview } = await import('../src/handlers/adminSubscriptions.mjs');
const { razorpay } = await import('../src/lib/razorpay.mjs');

function ownerEvent() {
  return { requestContext: { authorizer: { claims: { sub: 'user_owner1', 'cognito:groups': 'owner' } } } };
}

function plainUserEvent() {
  return { requestContext: { authorizer: { claims: { sub: 'user_plain1', 'cognito:groups': '' } } } };
}

describe('getSubscriptionsOverview', () => {
  test('rejects a non-OWNER caller without touching Razorpay', async (t) => {
    t.mock.method(razorpay.subscriptions, 'all', async () => {
      throw new Error('should not be called for a non-OWNER caller');
    });

    const response = await getSubscriptionsOverview(plainUserEvent());
    assert.equal(response.statusCode, 403);
  });

  test('returns byPlan/expiringWithinWeek/needsAttention for an OWNER caller', async (t) => {
    const now = Math.floor(Date.now() / 1000);
    t.mock.method(razorpay.subscriptions, 'all', async () => ({
      items: [
        {
          id: 'sub_1',
          status: 'active',
          notes: { user_id: 'user_a', plan: 'plus' },
          current_end: now + 2 * 24 * 60 * 60,
        },
      ],
    }));
    // listAllCognitoUsers (lib/cognitoUsers.mjs) calls this same client class
    // under the hood — mock at the SDK level, same as db.send elsewhere,
    // since the module-private `cognito` instance isn't exported to mock directly.
    t.mock.method(CognitoIdentityProviderClient.prototype, 'send', async () => ({
      Users: [{ Username: 'user_a', Attributes: [{ Name: 'sub', Value: 'user_a' }, { Name: 'email', Value: 'a@example.com' }] }],
    }));

    const response = await getSubscriptionsOverview(ownerEvent());
    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);

    const body = JSON.parse(response.body);
    assert.equal(body.byPlan.plus.activeCount, 1);
    assert.equal(body.expiringWithinWeek.length, 1);
    assert.equal(body.expiringWithinWeek[0].subscriptionId, 'sub_1');
    assert.equal(body.expiringWithinWeek[0].identifier, 'a@example.com');
  });
});
