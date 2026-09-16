import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { adminSetPlan } = await import('../src/handlers/settings.mjs');
const { db } = await import('../src/db.mjs');

function ownerEvent(userId, body) {
  return {
    requestContext: {
      authorizer: {
        claims: { sub: userId, 'cognito:groups': 'owner' },
      },
    },
    body: JSON.stringify(body),
  };
}

describe('adminSetPlan — DynamoDB call', () => {
  test('writes plan via an aliased #plan attribute name, not the bare reserved word', async (t) => {
    // Same bug class as billing.test.mjs's applySubscriptionState test —
    // this is the manual-recovery endpoint that bug's own PR pointed
    // support at, and it had the identical unaliased-reserved-word crash.
    let capturedCommand;
    t.mock.method(db, 'send', async (command) => {
      capturedCommand = command;
      return { Attributes: { user_id: 'user_owner1', plan: 'plus' } };
    });

    const response = await adminSetPlan(ownerEvent('user_owner1', { plan: 'plus' }));

    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
    assert.ok(capturedCommand, 'db.send should have been called');

    const { UpdateExpression, ExpressionAttributeNames } = capturedCommand.input;
    assert.equal(ExpressionAttributeNames?.['#plan'], 'plan');
    assert.match(UpdateExpression, /#plan/);
    assert.doesNotMatch(UpdateExpression, /(?<![#\w])plan(?!\w)/);
  });

  test('still rejects a non-OWNER caller (unrelated to the DynamoDB fix, but shares this handler)', async (t) => {
    t.mock.method(db, 'send', async () => {
      throw new Error('db.send should not be reached for a non-OWNER caller');
    });

    const event = {
      requestContext: { authorizer: { claims: { sub: 'user_plain1', 'cognito:groups': '' } } },
      body: JSON.stringify({ plan: 'plus' }),
    };
    const response = await adminSetPlan(event);
    assert.equal(response.statusCode, 403);
  });
});
