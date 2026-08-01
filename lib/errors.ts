/**
 * Shared error classification for network-level failures.
 *
 * fetch() throws a bare `TypeError: Failed to fetch` (web) / `TypeError:
 * Network request failed` (RN) when the request never reaches the server at
 * all — offline, DNS failure, CORS, backend down. This is categorically
 * different from an HTTP error response (4xx/5xx), which our proxy helpers
 * already turn into a normal `Error` with a `.status`. Callers need to tell
 * the two apart: an HTTP error means "the server said no" (safe to retry the
 * same action); a NetworkError means "we couldn't even ask" (retrying
 * immediately just repeats the failure and should not silently resume a
 * listening/recording loop).
 */
export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * An HTTP error response from our own backend (4xx/5xx). Carries the status
 * code and response body so callers can branch on it — a 404 from
 * `/audio-url` means "nothing stored", while a 500 means "the request
 * failed" and must not be presented to the user as an empty result.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message?: string,
  ) {
    super(message ?? `API ${status}: ${body.substring(0, 200)}`);
    this.name = 'HttpError';
  }
}

/** True for our own NetworkError, or a raw fetch-level TypeError we haven't wrapped yet. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('network request failed');
  }
  if (error && typeof error === 'object') {
    const code = (error as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return true;
    const message = (error as { message?: string }).message?.toLowerCase() ?? '';
    return message.includes('failed to fetch') || message.includes('network request failed');
  }
  return false;
}

/** Best-effort human-readable message for any thrown value. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
