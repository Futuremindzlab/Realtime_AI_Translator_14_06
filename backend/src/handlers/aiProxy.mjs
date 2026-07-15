/**
 * AI provider proxy — holds the real OpenAI / ElevenLabs / Azure Speech API keys
 * server-side so they never ship inside the client app bundle.
 *
 * The client keeps all product logic (which voice/model to use, fallback order,
 * script validation, SSML building, etc.) exactly as before — it just calls these
 * routes instead of the provider APIs directly. Every route requires the same
 * Cognito auth already enforced on /v1/{proxy+} by the API Gateway authorizer.
 *
 * Audio bodies are JSON + base64 (not multipart/binary) so no API Gateway binary
 * media type configuration is needed. Upstream error bodies are passed through
 * verbatim (status + raw text) so the client's existing status/detail parsing
 * (e.g. ElevenLabs 401 invalid_api_key vs quota_exceeded) keeps working unchanged.
 */

import { getUserId } from '../auth.mjs';
import { sendSuccess, sendError, handleError } from '../response.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

/** Relay an upstream provider's non-2xx response verbatim (status + raw body). */
function passthroughError(statusCode, rawBodyText) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS },
    body: rawBodyText || JSON.stringify({ error: `Upstream error ${statusCode}` }),
  };
}

const MAX_AUDIO_BYTES = 6 * 1024 * 1024; // Lambda sync invocation payload ceiling (both directions)

// ─────────────────────────────────────────────────────────
// POST /v1/proxy/openai/chat  — translation (and any other chat completion)
// Body: { model, messages, temperature?, max_tokens? }
// ─────────────────────────────────────────────────────────
export async function proxyOpenAIChat(event) {
  try {
    getUserId(event);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return sendError(500, 'OpenAI is not configured on the server');

    const body = JSON.parse(event.body || '{}');
    const { model, messages, temperature, max_tokens } = body;
    if (!model || !Array.isArray(messages) || messages.length === 0) {
      return sendError(400, 'model and messages[] are required');
    }

    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: temperature ?? 0.2,
        max_tokens: max_tokens ?? 1024,
      }),
    });

    const rawText = await upstream.text();
    if (!upstream.ok) return passthroughError(upstream.status, rawText);

    return sendSuccess(JSON.parse(rawText));
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/proxy/openai/tts
// Body: { model?, voice, input, speed?, response_format? }
// Returns: { audioBase64, contentType }
// ─────────────────────────────────────────────────────────
export async function proxyOpenAITts(event) {
  try {
    getUserId(event);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return sendError(500, 'OpenAI is not configured on the server');

    const body = JSON.parse(event.body || '{}');
    const { model, voice, input, speed, response_format } = body;
    if (!voice || !input) return sendError(400, 'voice and input are required');
    if (input.length > 4096) return sendError(400, 'input exceeds 4096 characters');

    const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'tts-1-hd',
        voice,
        input,
        speed: speed ?? 1.0,
        response_format: response_format || 'mp3',
      }),
    });

    if (!upstream.ok) return passthroughError(upstream.status, await upstream.text());

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) return sendError(502, 'TTS audio too large to return');

    return sendSuccess({
      audioBase64: Buffer.from(arrayBuffer).toString('base64'),
      contentType: 'audio/mpeg',
    });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/proxy/openai/transcribe
// Body: { audioBase64, fileName?, mimeType?, language?, prompt? }
// Returns: { text, detectedLanguage }
// ─────────────────────────────────────────────────────────
export async function proxyOpenAITranscribe(event) {
  try {
    getUserId(event);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return sendError(500, 'OpenAI is not configured on the server');

    const body = JSON.parse(event.body || '{}');
    const { audioBase64, fileName, mimeType, language, prompt } = body;
    if (!audioBase64) return sendError(400, 'audioBase64 is required');

    const buffer = Buffer.from(audioBase64, 'base64');
    if (buffer.length === 0) return sendError(400, 'Audio file is empty');
    if (buffer.length > MAX_AUDIO_BYTES) return sendError(400, 'Audio file is too large (max 6MB via this API)');

    const blob = new Blob([buffer], { type: mimeType || 'audio/wav' });

    const buildForm = (withLanguage) => {
      const fd = new FormData();
      fd.append('file', blob, fileName || 'recording.wav');
      fd.append('model', 'whisper-1');
      fd.append('response_format', 'verbose_json');
      fd.append('temperature', '0');
      if (withLanguage && language) fd.append('language', language);
      if (prompt) fd.append('prompt', prompt);
      return fd;
    };

    let upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: buildForm(true),
    });

    // Safety net: an unrecognised language code — retry prompt-only, same as the client used to.
    if (!upstream.ok && upstream.status === 400 && language) {
      upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: buildForm(false),
      });
    }

    if (!upstream.ok) return passthroughError(upstream.status, await upstream.text());

    const data = await upstream.json();
    return sendSuccess({ text: data.text, detectedLanguage: data.language });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/proxy/elevenlabs/tts
// Body: { voiceId, text, model_id, voice_settings, language_code? }
// Returns: { audioBase64, contentType }
// ─────────────────────────────────────────────────────────
export async function proxyElevenLabsTts(event) {
  try {
    getUserId(event);
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return sendError(500, 'ElevenLabs is not configured on the server');

    const body = JSON.parse(event.body || '{}');
    const { voiceId, text, model_id, voice_settings, language_code } = body;
    if (!voiceId || !text || !model_id) return sendError(400, 'voiceId, text and model_id are required');

    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id, voice_settings, ...(language_code ? { language_code } : {}) }),
    });

    if (!upstream.ok) return passthroughError(upstream.status, await upstream.text());

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) return sendError(502, 'TTS audio too large to return');

    return sendSuccess({
      audioBase64: Buffer.from(arrayBuffer).toString('base64'),
      contentType: 'audio/mpeg',
    });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/proxy/elevenlabs/voice-clone
// Body: { name, audioBase64, mimeType?, fileName? }
// Returns: { voice_id }
// ─────────────────────────────────────────────────────────
export async function proxyElevenLabsVoiceClone(event) {
  try {
    getUserId(event);
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return sendError(500, 'ElevenLabs is not configured on the server');

    const body = JSON.parse(event.body || '{}');
    const { name, audioBase64, mimeType, fileName } = body;
    if (!name || !audioBase64) return sendError(400, 'name and audioBase64 are required');

    const buffer = Buffer.from(audioBase64, 'base64');
    if (buffer.length === 0) return sendError(400, 'Audio is empty');
    if (buffer.length > MAX_AUDIO_BYTES) return sendError(400, 'Audio file is too large (max 6MB via this API)');

    const blob = new Blob([buffer], { type: mimeType || 'audio/m4a' });
    const fd = new FormData();
    fd.append('name', name);
    fd.append('description', 'Voice cloned from Realtime AI Translator app');
    fd.append('files', blob, fileName || 'voice_sample.m4a');

    const upstream = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: fd,
    });

    if (!upstream.ok) return passthroughError(upstream.status, await upstream.text());

    const data = await upstream.json();
    return sendSuccess({ voice_id: data.voice_id });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/proxy/azure/tts
// Body: { ssml }  — region/key come from server config, not the client.
// Returns: { audioBase64, contentType }
// ─────────────────────────────────────────────────────────
export async function proxyAzureTts(event) {
  try {
    getUserId(event);
    const apiKey = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!apiKey || !region) return sendError(500, 'Azure Speech is not configured on the server');

    const body = JSON.parse(event.body || '{}');
    const { ssml } = body;
    if (!ssml) return sendError(400, 'ssml is required');

    const upstream = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
      },
      body: ssml,
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      return sendError(upstream.status, `Azure TTS failed: ${errText.substring(0, 200)}`);
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) return sendError(502, 'TTS audio too large to return');

    return sendSuccess({
      audioBase64: Buffer.from(arrayBuffer).toString('base64'),
      contentType: 'audio/mpeg',
    });
  } catch (err) {
    return handleError(err);
  }
}
