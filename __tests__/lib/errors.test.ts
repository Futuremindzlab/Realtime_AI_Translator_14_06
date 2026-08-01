import { NetworkError, isNetworkError } from '@/lib/errors';

describe('NetworkError', () => {
  it('keeps the message, name and cause', () => {
    const cause = new TypeError('Failed to fetch');
    const err = new NetworkError('Unable to reach the server', cause);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NetworkError');
    expect(err.message).toBe('Unable to reach the server');
    expect(err.cause).toBe(cause);
  });
});

describe('isNetworkError', () => {
  it('recognises our own NetworkError', () => {
    expect(isNetworkError(new NetworkError('offline'))).toBe(true);
  });

  it('recognises the bare fetch-level TypeErrors from web and React Native', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(new TypeError('NETWORK REQUEST FAILED'))).toBe(true);
  });

  it('does not treat unrelated TypeErrors as network failures', () => {
    expect(isNetworkError(new TypeError('undefined is not a function'))).toBe(false);
  });

  it('recognises Node-style transport error codes', () => {
    for (const code of ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED']) {
      expect(isNetworkError({ code })).toBe(true);
    }
    expect(isNetworkError({ code: 'EACCES' })).toBe(false);
  });

  it('recognises plain objects whose message looks like a transport failure', () => {
    expect(isNetworkError({ message: 'Failed to fetch' })).toBe(true);
    expect(isNetworkError({ message: 'Network request failed' })).toBe(true);
    expect(isNetworkError({ message: 'Bad request' })).toBe(false);
    expect(isNetworkError({})).toBe(false);
  });

  it('does not treat HTTP errors or primitives as network failures', () => {
    const httpError: any = new Error('Whisper API error: 500');
    httpError.status = 500;

    expect(isNetworkError(httpError)).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError('Failed to fetch')).toBe(false);
  });
});
