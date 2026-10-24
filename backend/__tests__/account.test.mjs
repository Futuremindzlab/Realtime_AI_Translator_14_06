import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Same placeholder-env pattern as billing.test.mjs — razorpay.mjs
// constructs a live client at import time from these.
process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.ELEVENLABS_API_KEY = 'test_voice_key';

const { deleteAccount } = await import('../src/handlers/account.mjs');
const { db } = await import('../src/db.mjs');

function fakeEvent(userId) {
  return { requestContext: { authorizer: { claims: { sub: userId, email: 'someone@example.com' } } } };
}

describe('deleteAccount — cloned voice cleanup', () => {
  test('deletes the cloned voice at the provider before purging data', async (t) => {
    t.mock.method(db, 'send', async (command) => {
      if (command.constructor.name === 'GetCommand') {
        return { Item: { user_id: 'user_1', custom_voice_id: 'voice_abc' } };
      }
      // Fail the history purge so the handler stops before touching Cognito —
      // the voice delete must already have happened by then.
      throw new Error('stop here');
    });
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push({ url, method: init?.method });
      return { ok: true, status: 200 };
    });

    await deleteAccount(fakeEvent('user_1'));

    assert.deepEqual(calls, [{ url: 'https://api.elevenlabs.io/v1/voices/voice_abc', method: 'DELETE' }]);
  });

  test('a provider failure does not throw out of the voice cleanup step', async (t) => {
    let purgeReached = false;
    t.mock.method(db, 'send', async (command) => {
      if (command.constructor.name === 'GetCommand') {
        return { Item: { user_id: 'user_1', custom_voice_id: 'voice_abc' } };
      }
      purgeReached = true;
      throw new Error('stop here');
    });
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('network down');
    });

    await deleteAccount(fakeEvent('user_1'));

    assert.equal(purgeReached, true);
  });
});
