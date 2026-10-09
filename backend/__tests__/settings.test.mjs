import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { adminSetPlan, patchSettings } = await import('../src/handlers/settings.mjs');
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

function userEvent(userId, body) {
  return {
    requestContext: { authorizer: { claims: { sub: userId, 'cognito:groups': '' } } },
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

describe('patchSettings — full_name/country (billing/account basics)', () => {
  test('writes full_name and country via the allowlisted UpdateExpression', async (t) => {
    let capturedCommand;
    t.mock.method(db, 'send', async (command) => {
      capturedCommand = command;
      return { Attributes: { user_id: 'user_1', full_name: 'Jane Doe', country: 'India' } };
    });

    const response = await patchSettings(userEvent('user_1', { full_name: 'Jane Doe', country: 'India' }));

    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
    const { ExpressionAttributeNames, ExpressionAttributeValues } = capturedCommand.input;
    // Names/values pair by matching index — #k0 -> :v0, #k1 -> :v1, etc.
    const nameKey    = Object.keys(ExpressionAttributeNames).find((k) => ExpressionAttributeNames[k] === 'full_name');
    const countryKey = Object.keys(ExpressionAttributeNames).find((k) => ExpressionAttributeNames[k] === 'country');
    assert.ok(nameKey, 'full_name should be in the UpdateExpression');
    assert.ok(countryKey, 'country should be in the UpdateExpression');
    assert.equal(ExpressionAttributeValues[`:v${nameKey.slice(2)}`], 'Jane Doe');
    assert.equal(ExpressionAttributeValues[`:v${countryKey.slice(2)}`], 'India');
  });

  test('rejects an empty full_name', async () => {
    const response = await patchSettings(userEvent('user_1', { full_name: '   ' }));
    assert.equal(response.statusCode, 400);
  });

  test('rejects a non-string country', async () => {
    const response = await patchSettings(userEvent('user_1', { country: 42 }));
    assert.equal(response.statusCode, 400);
  });

  test('accepts full_name explicitly set to null (clearing it)', async (t) => {
    t.mock.method(db, 'send', async () => ({ Attributes: { user_id: 'user_1', full_name: null } }));
    const response = await patchSettings(userEvent('user_1', { full_name: null }));
    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
  });
});
