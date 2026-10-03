/**
 * Pulls a human-readable message out of a backend proxy error body, which
 * comes in two different shapes depending on who actually generated it:
 *   - Our own backend errors (bad request, a daily usage-cap 429, etc. — see
 *     backend/src/response.mjs's sendError): { error: "a string" }.
 *   - A genuine upstream provider error relayed verbatim (see aiProxy.mjs's
 *     passthroughError): { error: { message: "...", type: "...", code: "..." } } —
 *     OpenAI's own nested shape, not a string.
 * Without this, `new Error(errorData.error)` on the second shape stringifies
 * the whole object to the useless literal "[object Object]" instead of the
 * actual message.
 *
 * Kept in its own dependency-free module (same reasoning as
 * lib/conversationTurnLanguage.ts) so it's directly unit-testable — the
 * services that actually call the proxy (openaiService.ts, etc.) pull in
 * @sentry/react-native transitively, which ships ESM Jest can't parse under
 * this project's Babel config.
 */
export function extractErrorMessage(errorData: any): string | undefined {
  const raw = errorData?.error;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw.message === 'string') return raw.message;
  return undefined;
}
