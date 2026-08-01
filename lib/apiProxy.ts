/**
 * Shared client for the backend's AI-provider proxy routes (/v1/proxy/*).
 *
 * OpenAI / ElevenLabs / Azure API keys live only in the Lambda backend now —
 * the client never holds them. Every proxy route reuses the same Cognito
 * idToken already obtained for DynamoService, so the caller just needs the
 * request-specific JSON body; auth + base URL are handled here.
 */
import { dynamoService } from '@/services/dynamoService';
import { NetworkError, isNetworkError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

/** Wraps a raw fetch() call and re-throws transport-level failures (offline, DNS,
 *  CORS, backend unreachable) as a typed NetworkError instead of letting the
 *  browser's bare `TypeError: Failed to fetch` propagate unclassified. */
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    logger.error('Network request failed', err, { url });
    if (isNetworkError(err)) {
      throw new NetworkError('Unable to reach the server — check your internet connection.', err);
    }
    throw err;
  }
}

/** POST JSON to one of our backend's AI-provider proxy routes. Returns the raw Response
 *  so callers can keep their existing .ok / .status / .json() / .text() handling.
 *  Throws NetworkError (see lib/errors.ts) if the request never reaches the server. */
export async function proxyPost(path: string, body: Record<string, any>): Promise<Response> {
  if (!API_BASE) throw new Error('EXPO_PUBLIC_API_BASE_URL is not set in .env');

  const doFetch = (token: string) =>
    safeFetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

  let idToken = dynamoService.getIdToken();
  if (!idToken) throw new Error('Not signed in — cannot reach AI services');

  let response = await doFetch(idToken);

  // Cognito ID tokens expire after 1 hour and nothing else in the app refreshes
  // them — a conversation-mode session left open past that window would
  // otherwise have every transcribe/translate/TTS call fail from here on.
  // Refresh once and retry transparently before giving up.
  if (response.status === 401) {
    const refreshed = await dynamoService.refreshSessionIfPossible();
    if (refreshed) {
      idToken = dynamoService.getIdToken();
      if (idToken) response = await doFetch(idToken);
    }
  }

  return response;
}
