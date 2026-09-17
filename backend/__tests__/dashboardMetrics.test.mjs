import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';

process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';

const { getDashboardMetrics } = await import('../src/handlers/dashboardMetrics.mjs');
const { db, TRANSLATIONS_TABLE, SETTINGS_TABLE } = await import('../src/db.mjs');
const { razorpay } = await import('../src/lib/razorpay.mjs');

function ownerEvent() {
  return { requestContext: { authorizer: { claims: { sub: 'user_owner1', 'cognito:groups': 'owner' } } } };
}

function plainUserEvent() {
  return { requestContext: { authorizer: { claims: { sub: 'user_plain1', 'cognito:groups': '' } } } };
}

describe('getDashboardMetrics — scanUserSubscriptionStates DynamoDB call', () => {
  test('rejects a non-OWNER caller without touching DynamoDB', async (t) => {
    t.mock.method(db, 'send', async () => {
      throw new Error('should not be called for a non-OWNER caller');
    });

    const response = await getDashboardMetrics(plainUserEvent());
    assert.equal(response.statusCode, 403);
  });

  test('scans SETTINGS_TABLE via an aliased #plan attribute name, not the bare reserved word', async (t) => {
    // Same reserved-keyword bug as adminPayments.mjs's scanActiveUsers —
    // "Invalid ProjectionExpression: Attribute name is a reserved keyword;
    // reserved keyword: plan", breaking this dashboard's User Analytics page
    // (which calls this handler for Revenue/Engagement/AWS Cost/Churn) on
    // every real load.
    let capturedSettingsCommand;
    t.mock.method(db, 'send', async (command) => {
      if (command.input.TableName === TRANSLATIONS_TABLE) return { Items: [] };
      if (command.input.TableName === SETTINGS_TABLE) {
        capturedSettingsCommand = command;
        return { Items: [] };
      }
      throw new Error(`unexpected table scanned: ${command.input.TableName}`);
    });
    t.mock.method(CognitoIdentityProviderClient.prototype, 'send', async () => ({ Users: [] }));
    t.mock.method(CostExplorerClient.prototype, 'send', async () => {
      throw new Error('Cost Explorer not enabled — expected in this test');
    });
    t.mock.method(razorpay.payments, 'all', async () => ({ items: [] }));
    t.mock.method(razorpay.subscriptions, 'all', async () => ({ items: [] }));

    const response = await getDashboardMetrics(ownerEvent());
    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
    assert.ok(capturedSettingsCommand, 'the settings-table scan should have been called');

    const { ProjectionExpression, ExpressionAttributeNames } = capturedSettingsCommand.input;
    assert.equal(ExpressionAttributeNames?.['#plan'], 'plan');
    assert.match(ProjectionExpression, /#plan/);
    assert.doesNotMatch(ProjectionExpression, /(?<![#\w])plan(?!\w)/);
  });
});
