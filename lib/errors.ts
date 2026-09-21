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

/** True for our own NetworkError, or a raw fetch-level TypeError we haven't wrapped yet. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('network request failed');
  }
  if (error && typeof error === 'object') {
    const code = (error as { code?: string }).code;
    // 'NetworkError' (exact) is amazon-cognito-identity-js's own wrapping: its
    // Client.js catches the raw fetch TypeError and rethrows `new
    // Error('Network error')` with `.code = 'NetworkError'` (see
    // node_modules/amazon-cognito-identity-js/src/Client.js) — every Cognito
    // call (sign-in, sign-up, forgot-password, OTP) goes through this, so the
    // original TypeError never reaches callers at all. Without matching this
    // shape too, a connectivity blip during e.g. forgotPassword() surfaced as
    // a bare, unclassified "Network error" instead of being recognized here.
    if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'NetworkError') return true;
    const message = (error as { message?: string }).message?.toLowerCase() ?? '';
    return message.includes('failed to fetch') || message.includes('network request failed') || message === 'network error';
  }
  return false;
}
