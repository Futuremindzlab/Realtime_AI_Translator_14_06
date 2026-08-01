import { proxyPost } from '@/lib/apiProxy';
import { translationProvider } from '@/services/translationProvider';

jest.mock('@/lib/apiProxy', () => ({ proxyPost: jest.fn() }));

const proxyPostMock = proxyPost as jest.MockedFunction<typeof proxyPost>;

const chatResponse = (content: string) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  }) as unknown as Response;

const errorResponse = (status: number, body: string) =>
  ({
    ok: false,
    status,
    statusText: 'Error',
    text: async () => body,
    json: async () => ({}),
  }) as unknown as Response;

/** The request body handed to the /v1/proxy/openai/chat route. */
const lastRequestBody = () => proxyPostMock.mock.calls[proxyPostMock.mock.calls.length - 1][1];
const systemPrompt = () => lastRequestBody().messages[0].content as string;

describe('translationProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    translationProvider.setProvider('openai');
  });

  describe('provider selection', () => {
    it('defaults to the cloud provider and can be switched', () => {
      expect(translationProvider.getProvider()).toBe('openai');

      translationProvider.setProvider('device');
      expect(translationProvider.getProvider()).toBe('device');
    });

    it('reports the device model as not ready before anything is loaded', () => {
      expect(translationProvider.isDeviceReady()).toBe(false);
    });
  });

  describe('translate (cloud)', () => {
    it('returns the trimmed translation and streams it to onChunk', async () => {
      proxyPostMock.mockResolvedValue(chatResponse('  Hola  '));
      const onChunk = jest.fn();

      await expect(translationProvider.translate('Hello', 'en', 'es', onChunk)).resolves.toBe('Hola');

      expect(onChunk).toHaveBeenCalledWith('Hola');
      expect(proxyPostMock).toHaveBeenCalledWith('/v1/proxy/openai/chat', expect.any(Object));
    });

    it('sends the source text as the user message with a deterministic temperature', async () => {
      proxyPostMock.mockResolvedValue(chatResponse('Hola'));

      await translationProvider.translate('Hello', 'en', 'es', jest.fn());

      expect(lastRequestBody()).toMatchObject({
        temperature: 0.2,
        messages: [
          { role: 'system', content: expect.any(String) },
          { role: 'user', content: 'Hello' },
        ],
      });
    });

    it('uses gpt-4o-mini for Latin-script targets', async () => {
      proxyPostMock.mockResolvedValue(chatResponse('Hola'));

      await translationProvider.translate('Hello', 'en', 'es', jest.fn());

      expect(lastRequestBody().model).toBe('gpt-4o-mini');
    });

    it('upgrades to gpt-4o for high-quality (Indic / RTL) targets', async () => {
      proxyPostMock.mockResolvedValue(chatResponse('നന്ദി'));

      await translationProvider.translate('Thanks', 'en', 'ml', jest.fn());

      expect(lastRequestBody().model).toBe('gpt-4o');
    });

    it('names both languages in the system prompt and forbids transliteration', async () => {
      proxyPostMock.mockResolvedValue(chatResponse('நன்றி'));

      await translationProvider.translate('Thanks', 'en', 'ta', jest.fn());

      expect(systemPrompt()).toContain('from English to Tamil');
      expect(systemPrompt()).toContain('no transliteration');
    });

    it('adds a native-script example for languages prone to romanisation', async () => {
      proxyPostMock.mockResolvedValue(chatResponse('നന്ദി'));

      await translationProvider.translate('Thanks', 'en', 'ml', jest.fn());

      expect(systemPrompt()).toContain('നന്ദി');
    });

    it('omits the script example for Latin-script targets', async () => {
      proxyPostMock.mockResolvedValue(chatResponse('Hola'));

      await translationProvider.translate('Hello', 'en', 'es', jest.fn());

      expect(systemPrompt()).not.toContain('not "');
    });

    it('falls back to the raw code when a language has no display name', async () => {
      proxyPostMock.mockResolvedValue(chatResponse('...'));

      await translationProvider.translate('Hello', 'en', 'xx', jest.fn());

      expect(systemPrompt()).toContain('from English to xx');
    });

    it('surfaces the HTTP status and body on an API error', async () => {
      proxyPostMock.mockResolvedValue(errorResponse(500, 'upstream exploded'));
      const onChunk = jest.fn();

      await expect(translationProvider.translate('Hello', 'en', 'es', onChunk)).rejects.toThrow(
        'Translation API error 500: upstream exploded',
      );
      expect(onChunk).not.toHaveBeenCalled();
    });

    it('rejects an empty completion rather than returning an empty translation', async () => {
      proxyPostMock.mockResolvedValue(chatResponse('   '));

      await expect(translationProvider.translate('Hello', 'en', 'es', jest.fn())).rejects.toThrow(
        'Translation API returned an empty result',
      );
    });

    it('propagates transport failures from the proxy', async () => {
      const cause = new Error('Unable to reach the server');
      proxyPostMock.mockRejectedValue(cause);

      await expect(translationProvider.translate('Hello', 'en', 'es', jest.fn())).rejects.toBe(cause);
    });
  });
});
