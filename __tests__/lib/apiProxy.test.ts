const mockGetIdToken = jest.fn();
const mockRefreshSession = jest.fn();

jest.mock('@/services/dynamoService', () => ({
  dynamoService: {
    getIdToken: () => mockGetIdToken(),
    refreshSessionIfPossible: () => mockRefreshSession(),
  },
}));

const API_BASE = 'https://api.example.com';

/** apiProxy reads EXPO_PUBLIC_API_BASE_URL once at import time. */
function loadProxyPost(baseUrl: string | undefined) {
  let proxyPost!: typeof import('@/lib/apiProxy').proxyPost;
  jest.isolateModules(() => {
    const previous = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (baseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = baseUrl;
    proxyPost = require('@/lib/apiProxy').proxyPost;
    if (previous === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = previous;
  });
  return proxyPost;
}

const jsonResponse = (status: number) => ({ ok: status < 400, status }) as Response;

describe('proxyPost', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetIdToken.mockReturnValue('token-1');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts JSON to the configured base URL with the Cognito bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200));

    const response = await loadProxyPost(API_BASE)('/v1/proxy/openai/chat', { model: 'gpt-4o' });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/v1/proxy/openai/chat`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-1',
    });
    expect(JSON.parse(init.body)).toEqual({ model: 'gpt-4o' });
  });

  it('strips a trailing slash from the base URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200));

    await loadProxyPost(`${API_BASE}/`)('/v1/proxy/openai/chat', {});

    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/v1/proxy/openai/chat`);
  });

  it('throws before fetching when the API base URL is not configured', async () => {
    await expect(loadProxyPost('')('/v1/proxy/openai/chat', {})).rejects.toThrow(
      'EXPO_PUBLIC_API_BASE_URL is not set in .env',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws before fetching when there is no signed-in session', async () => {
    mockGetIdToken.mockReturnValue(null);

    await expect(loadProxyPost(API_BASE)('/v1/proxy/openai/chat', {})).rejects.toThrow(
      'Not signed in',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes the expired ID token once and retries on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401)).mockResolvedValueOnce(jsonResponse(200));
    mockGetIdToken.mockReturnValueOnce('stale').mockReturnValue('fresh');
    mockRefreshSession.mockResolvedValue(true);

    const response = await loadProxyPost(API_BASE)('/v1/proxy/openai/chat', {});

    expect(response.status).toBe(200);
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer stale');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');
  });

  it('returns the 401 when the session cannot be refreshed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401));
    mockRefreshSession.mockResolvedValue(false);

    const response = await loadProxyPost(API_BASE)('/v1/proxy/openai/chat', {});

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-401 error responses', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500));

    const response = await loadProxyPost(API_BASE)('/v1/proxy/openai/chat', {});

    expect(response.status).toBe(500);
    expect(mockRefreshSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('wraps transport-level fetch failures in a NetworkError', async () => {
    const cause = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(cause);

    // The module under test is re-required in an isolated registry, so assert on
    // the error's shape rather than on class identity.
    await expect(loadProxyPost(API_BASE)('/v1/proxy/openai/chat', {})).rejects.toMatchObject({
      name: 'NetworkError',
      message: expect.stringContaining('Unable to reach the server'),
      cause,
    });
  });

  it('re-throws non-network fetch failures unchanged', async () => {
    const cause = new Error('aborted');
    fetchMock.mockRejectedValue(cause);

    await expect(loadProxyPost(API_BASE)('/v1/proxy/openai/chat', {})).rejects.toBe(cause);
  });
});
