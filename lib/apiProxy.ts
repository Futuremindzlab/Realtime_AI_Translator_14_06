/**
 * Shared client for the backend's AI-provider proxy routes (/v1/proxy/*).
 *
 * OpenAI / ElevenLabs / Azure API keys live only in the Lambda backend now —
 * the client never holds them. Every proxy route reuses the same Cognito
 * idToken already obtained for DynamoService, so the caller just needs the
 * request-specific JSON body; auth + base URL are handled here.
 */
import { dynamoService } from '@/services/dynamoService';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

/** POST JSON to one of our backend's AI-provider proxy routes. Returns the raw Response
 *  so callers can keep their existing .ok / .status / .json() / .text() handling. */
export async function proxyPost(path: string, body: Record<string, any>): Promise<Response> {
  const idToken = dynamoService.getIdToken();
  if (!idToken) throw new Error('Not signed in — cannot reach AI services');
  if (!API_BASE) throw new Error('EXPO_PUBLIC_API_BASE_URL is not set in .env');

  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
}
