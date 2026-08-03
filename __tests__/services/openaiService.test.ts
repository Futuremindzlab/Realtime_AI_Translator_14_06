import { proxyPost } from '@/lib/apiProxy';
import { NetworkError } from '@/lib/errors';
import { OpenAIService } from '@/services/openaiService';

jest.mock('@/lib/apiProxy', () => ({ proxyPost: jest.fn() }));

const proxyPostMock = proxyPost as jest.MockedFunction<typeof proxyPost>;

/** Stub the blob read performed by readAudioAsBase64() before the proxy call. */
function mockAudioFile(base64: string, mimeType = 'audio/wav') {
  const blob = { type: mimeType } as Blob;
  global.fetch = jest.fn().mockResolvedValue({ blob: async () => blob }) as unknown as typeof fetch;

  class FakeFileReader {
    result: string | null = null;
    onloadend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      this.result = `data:${mimeType};base64,${base64}`;
      this.onloadend?.();
    }
  }
  (global as any).FileReader = FakeFileReader;
}

const okResponse = (body: Record<string, unknown>) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const errorResponse = (status: number, body: Record<string, unknown> = {}) =>
  ({ ok: false, status, json: async () => body }) as unknown as Response;

/** Base64 large enough to clear the "audio file is empty" guard. */
const AUDIO_B64 = 'A'.repeat(4000);

describe('OpenAIService', () => {
  let service: OpenAIService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    service = new OpenAIService();
    mockAudioFile(AUDIO_B64);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tracks initialization state', () => {
    expect(service.isInitialized()).toBe(false);

    service.initialize('unused-client-side');
    expect(service.isInitialized()).toBe(true);
  });

  describe('transcribe', () => {
    it('returns the text and detected language from the proxy', async () => {
      proxyPostMock.mockResolvedValue(okResponse({ text: 'hello there', detectedLanguage: 'en' }));

      await expect(service.transcribe('file:///rec.wav')).resolves.toEqual({
        text: 'hello there',
        detectedLanguage: 'en',
      });
    });

    it('omits the language hint when auto-detecting', async () => {
      proxyPostMock.mockResolvedValue(okResponse({ text: 'hi' }));

      await service.transcribe('file:///rec.wav', 'auto');

      const body = proxyPostMock.mock.calls[0][1];
      expect(proxyPostMock.mock.calls[0][0]).toBe('/v1/proxy/openai/transcribe');
      expect(body.language).toBeUndefined();
      expect(body.prompt).toBeUndefined();
      expect(body.audioBase64).toBe(AUDIO_B64);
    });

    it('normalises a locale tag to its ISO code and attaches the script seed prompt', async () => {
      proxyPostMock.mockResolvedValue(okResponse({ text: 'നന്ദി' }));

      await service.transcribe('file:///rec.wav', 'ml-IN');

      const body = proxyPostMock.mock.calls[0][1];
      expect(body.language).toBe('ml');
      expect(body.prompt).toContain('മലയാളം');
    });

    it('remaps Filipino to the Tagalog code Whisper expects', async () => {
      proxyPostMock.mockResolvedValue(okResponse({ text: 'salamat' }));

      await service.transcribe('file:///rec.wav', 'fil');

      expect(proxyPostMock.mock.calls[0][1].language).toBe('tl');
    });

    it('drops the language for codes Whisper rejects, keeping the request valid', async () => {
      proxyPostMock.mockResolvedValue(okResponse({ text: 'text' }));

      await service.transcribe('file:///rec.wav', 'or');

      expect(proxyPostMock.mock.calls[0][1].language).toBeUndefined();
    });

    it('rejects an empty recording before calling the proxy', async () => {
      mockAudioFile('');

      await expect(service.transcribe('file:///rec.wav')).rejects.toThrow('Audio file is empty');
      expect(proxyPostMock).not.toHaveBeenCalled();
    });

    it('rejects a recording that exceeds the request size limit', async () => {
      mockAudioFile('A'.repeat(9 * 1024 * 1024));

      await expect(service.transcribe('file:///rec.wav')).rejects.toThrow('too long');
      expect(proxyPostMock).not.toHaveBeenCalled();
    });

    describe('error classification', () => {
      it('raises a NetworkError for transport-level failures so callers stop retrying', async () => {
        proxyPostMock.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(service.transcribe('file:///rec.wav')).rejects.toBeInstanceOf(NetworkError);
      });

      it('re-wraps an already-typed NetworkError', async () => {
        proxyPostMock.mockRejectedValue(new NetworkError('offline'));

        await expect(service.transcribe('file:///rec.wav')).rejects.toThrow(
          'Network error. Please check your internet connection.',
        );
      });

      it('hides auth failures behind a user-facing message', async () => {
        proxyPostMock.mockResolvedValue(errorResponse(401));

        await expect(service.transcribe('file:///rec.wav')).rejects.toThrow(
          'Transcription service is temporarily unavailable. Please try again shortly.',
        );
      });

      it('reports quota / rate-limit failures distinctly', async () => {
        proxyPostMock.mockResolvedValue(errorResponse(429));

        await expect(service.transcribe('file:///rec.wav')).rejects.toThrow(
          'Transcription quota exceeded or rate limited. Please try again later.',
        );
      });

      it('surfaces the upstream detail on a 400', async () => {
        proxyPostMock.mockResolvedValue(errorResponse(400, { error: 'unsupported language' }));

        await expect(service.transcribe('file:///rec.wav')).rejects.toThrow(
          'Bad request to transcription service: unsupported language',
        );
      });

      it('falls back to a generic message for unclassified failures', async () => {
        proxyPostMock.mockResolvedValue(errorResponse(503));

        await expect(service.transcribe('file:///rec.wav')).rejects.toThrow(
          'Failed to transcribe audio: Whisper API error: 503',
        );
      });
    });
  });
});
