import { extractErrorMessage } from '@/lib/proxyErrors';

// Bug fix covered here: the transcribe proxy's error body comes in two
// different shapes depending on who generated it (our own backend vs. a
// genuine upstream OpenAI error relayed verbatim — see
// extractErrorMessage's own doc comment and aiProxy.mjs's passthroughError).
// Getting this wrong either throws away a specific, actionable message (our
// own daily usage-cap 429) or stringifies an object into the literal
// "[object Object]" (OpenAI's nested error shape).
describe('extractErrorMessage', () => {
  it('extracts our own backend error shape: { error: "a string" }', () => {
    expect(extractErrorMessage({
      error: "Daily AI usage limit reached for the 'basic' plan (20 requests/day). Try again tomorrow, or upgrade your plan.",
    })).toBe("Daily AI usage limit reached for the 'basic' plan (20 requests/day). Try again tomorrow, or upgrade your plan.");
  });

  it("extracts OpenAI's own nested error shape: { error: { message, type, code } }", () => {
    expect(extractErrorMessage({
      error: { message: 'You exceeded your current quota.', type: 'insufficient_quota', code: 'insufficient_quota' },
    })).toBe('You exceeded your current quota.');
  });

  it('returns undefined for a body with no usable message, rather than stringifying it', () => {
    expect(extractErrorMessage({})).toBeUndefined();
    expect(extractErrorMessage({ error: { type: 'rate_limit_exceeded' } })).toBeUndefined(); // no .message field
    expect(extractErrorMessage(null)).toBeUndefined();
    expect(extractErrorMessage(undefined)).toBeUndefined();
  });

  it('never returns the literal "[object Object]" for an object-shaped error', () => {
    const result = extractErrorMessage({ error: { message: 'Rate limit exceeded' } });
    expect(result).not.toBe('[object Object]');
    expect(result).toBe('Rate limit exceeded');
  });
});
