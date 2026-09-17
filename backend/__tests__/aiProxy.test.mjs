import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.ELEVENLABS_API_KEY = 'test_elevenlabs_key';

const { proxyElevenLabsVoiceClone } = await import('../src/handlers/aiProxy.mjs');
const { db } = await import('../src/db.mjs');

function eventFor(userId, body) {
  return {
    requestContext: { authorizer: { claims: { sub: userId } } },
    body: JSON.stringify(body),
  };
}

function mockPlan(t, plan) {
  t.mock.method(db, 'send', async () => ({ Item: { user_id: 'user_1', plan } }));
}

describe('proxyElevenLabsVoiceClone — Live-plan gate', () => {
  test('rejects a basic-plan caller with 403, without calling ElevenLabs', async (t) => {
    mockPlan(t, 'basic');
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('should not reach ElevenLabs for a non-Live caller');
    });

    const response = await proxyElevenLabsVoiceClone(
      eventFor('user_1', { name: 'MyVoice', audioBase64: Buffer.from('audio').toString('base64') })
    );
    assert.equal(response.statusCode, 403);
    assert.match(JSON.parse(response.body).error, /live/i);
  });

  test('rejects a plus-plan caller with 403 — plus does not meet the live minimum', async (t) => {
    mockPlan(t, 'plus');
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('should not reach ElevenLabs for a non-Live caller');
    });

    const response = await proxyElevenLabsVoiceClone(
      eventFor('user_1', { name: 'MyVoice', audioBase64: Buffer.from('audio').toString('base64') })
    );
    assert.equal(response.statusCode, 403);
  });

  test('allows a live-plan caller through to ElevenLabs', async (t) => {
    mockPlan(t, 'live');
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ voice_id: 'voice_abc123' }),
    }));

    const response = await proxyElevenLabsVoiceClone(
      eventFor('user_1', { name: 'MyVoice', audioBase64: Buffer.from('audio').toString('base64') })
    );
    assert.equal(response.statusCode, 200, `expected success, got: ${response.body}`);
    assert.equal(JSON.parse(response.body).voice_id, 'voice_abc123');
  });
});
