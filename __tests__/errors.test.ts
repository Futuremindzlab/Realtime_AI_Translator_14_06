import { NetworkError, isNetworkError } from '@/lib/errors';

describe('isNetworkError', () => {
  it('recognizes our own NetworkError', () => {
    expect(isNetworkError(new NetworkError('offline'))).toBe(true);
  });

  it('recognizes a raw web fetch() TypeError', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('recognizes a raw React Native fetch() TypeError', () => {
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
  });

  it('recognizes amazon-cognito-identity-js\'s wrapped "Network error" (.code shape)', () => {
    const err = Object.assign(new Error('Network error'), { code: 'NetworkError' });
    expect(isNetworkError(err)).toBe(true);
  });

  it('recognizes the same Cognito wrapping by message alone, no .code', () => {
    expect(isNetworkError(new Error('Network error'))).toBe(true);
  });

  it('recognizes common Node-level connection error codes', () => {
    for (const code of ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED']) {
      expect(isNetworkError({ code, message: 'boom' })).toBe(true);
    }
  });

  it('does NOT classify a normal HTTP error response as a network error', () => {
    // The distinction the whole module exists for: a 4xx/5xx means the
    // server was reachable and said no — very different UX than "couldn't
    // even ask". Getting this backwards would make AuthContext suppress a
    // real, actionable server error behind a generic "check your connection"
    // message.
    const httpError = Object.assign(new Error('Forbidden'), { status: 403 });
    expect(isNetworkError(httpError)).toBe(false);
  });

  it('does NOT classify an unrelated error', () => {
    expect(isNetworkError(new Error('Password must be at least 8 characters'))).toBe(false);
  });

  it('handles non-error inputs without throwing', () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError('a plain string')).toBe(false);
    expect(isNetworkError(42)).toBe(false);
  });
});
