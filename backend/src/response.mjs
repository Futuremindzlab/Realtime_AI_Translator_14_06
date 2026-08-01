/** Standard CORS headers added to every response */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

export const sendSuccess    = (data)    => json(200, data);
export const sendCreated    = (data)    => json(201, data);
export const sendNoContent  = ()        => ({ statusCode: 204, headers: CORS, body: '' });

export const sendError = (statusCode, message, detail) =>
  json(statusCode, { error: message, ...(detail ? { detail } : {}) });

/**
 * Convert caught errors into structured API responses.
 *
 * `context` (route, userId, …) is logged alongside the stack so a 500 in
 * CloudWatch can be tied back to the request that caused it instead of being
 * an anonymous one-line message.
 */
export function handleError(err, context = {}) {
  const code = err?.statusCode || 500;
  console.error(JSON.stringify({
    level: code >= 500 ? 'error' : 'warn',
    message: 'Lambda error',
    status: code,
    error: err?.message ?? String(err),
    stack: err?.stack,
    ...context,
  }));
  return sendError(code, err?.message || 'Internal server error');
}
