import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';

const { getPaymentsOverview } = await import('../src/handlers/adminPayments.mjs');
const { db } = await import('../src/db.mjs');
const { razorpay } = await import('../src/lib/razorpay.mjs');

function ownerEvent() {
  return { requestContext: { authorizer: { claims: { sub: 'user_owner1', 'cognito:groups': 'owner' } } } };
}

function plainUserEvent() {
  return { requestContext: { authorizer: { claims: { sub: 'user_plain1', 'cognito:groups': '' } } } };
}

describe('getPaymentsOverview — scanActiveUsers DynamoDB call', () => {
  test('rejects a non-OWNER caller without touching DynamoDB or Razorpay', async (t) => {
    t.mock.method(db, 'send', async () => {
      throw new Error('should not be called for a non-OWNER caller');
    });

    const response = await getPaymentsOverview(plainUserEvent());
    assert.equal(response.statusCode, 403);
  });

  test('scans SETTINGS_TABLE via an aliased #plan attribute name, not the bare reserved word', async (t) => {
    // The exact production bug this session hit twice: 'plan' is a DynamoDB
    // reserved keyword — a Scan's ProjectionExpression using it bare fails at
    // request time with "Invalid ProjectionExpression: Attribute name is a
    // reserved keyword; reserved keyword: plan", breaking this dashboard's
    // Payments page on every real load.
    let capturedCommand;
    t.mock.method(db, 'send', async (command) => {
      capturedCommand = command;
      return { Items: [] };
    });
    t.mock.method(razorpay.payments, 'all', async () => ({ items: [] }));
    t.mock.method(CognitoIdentityProviderClient.prototype, 'send', async () => ({ Users: [] }));

    const response = await getPaymentsOverview(ownerEvent());
    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
    assert.ok(capturedCommand, 'db.send should have been called');

    const { ProjectionExpression, ExpressionAttributeNames } = capturedCommand.input;
    assert.equal(ExpressionAttributeNames?.['#plan'], 'plan');
    assert.match(ProjectionExpression, /#plan/);
    assert.doesNotMatch(ProjectionExpression, /(?<![#\w])plan(?!\w)/);
  });
});
