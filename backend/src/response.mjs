/**
 * Standard JSON/CORS response helpers.
 *
 * CORS: set CORS_ALLOWED_ORIGINS (comma-separated origins) to restrict browser
 * access to the Expo web build's own origins. The request Origin is echoed back
 * only when it is on that list; anything else gets no CORS header at all, so a
 * third-party page can't read authenticated responses. Native iOS/Android
 * clients send no Origin and ignore CORS entirely, so they are unaffected.
 * When the variable is unset the API falls back to '*' (open) — deploy with it
 * set (see template.yaml's CorsAllowedOrigins parameter).
 */

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// The origin of the request currently being handled. A Lambda container serves
// one invocation at a time, so a module-level value is safe and keeps every
// sendSuccess/sendError call site free of an extra `event` argument.
let requestOrigin = null;

/** Called once per invocation by the router before any response is built. */
export function setRequestOrigin(event) {
  const headers = event?.headers || {};
  requestOrigin = headers.origin || headers.Origin || null;
}

/** CORS headers for the current request. */
export function corsHeaders() {
  const base = {
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };

  if (ALLOWED_ORIGINS.length === 0) return { ...base, 'Access-Control-Allow-Origin': '*' };

  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return { ...base, 'Access-Control-Allow-Origin': requestOrigin, Vary: 'Origin' };
  }

  return { ...base, Vary: 'Origin' };
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  body: JSON.stringify(body),
});

export const sendSuccess    = (data)    => json(200, data);
export const sendCreated    = (data)    => json(201, data);
export const sendNoContent  = ()        => ({ statusCode: 204, headers: corsHeaders(), body: '' });

export const sendError = (statusCode, message, detail) =>
  json(statusCode, { error: message, ...(detail ? { detail } : {}) });

/**
 * Convert caught errors into structured API responses.
 * Only errors carrying an explicit statusCode (thrown deliberately by our own
 * validation/auth code) expose their message; unexpected failures are logged
 * and reported generically so stack/internal details never reach the client.
 */
export function handleError(err) {
  console.error('Lambda error:', err);
  const code = err.statusCode || 500;
  if (code >= 500) return sendError(code, 'Internal server error');
  return sendError(code, err.message || 'Request failed');
}
