/**
 * Kept dependency-free (same reasoning as lib/proxyErrors.ts) so it's
 * directly unit-testable — services/ocrTranslateService.ts, which actually
 * calls the proxy, pulls in @sentry/react-native transitively via
 * lib/apiProxy.ts, which ships ESM Jest can't parse under this project's
 * Babel config.
 */

/**
 * gpt-4o is told to return bare JSON, but like any chat model it sometimes
 * wraps it in a ```json fence or adds a stray lead-in sentence anyway — strip
 * a fence if present, then pull out the first {...} block rather than trusting
 * the whole response to be valid JSON on its own.
 */
export function extractJson(raw: string): any {
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const match = unfenced.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model did not return a JSON object');
  return JSON.parse(match[0]);
}
