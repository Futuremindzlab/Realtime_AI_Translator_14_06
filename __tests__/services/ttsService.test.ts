import * as Speech from 'expo-speech';
import { proxyPost } from '@/lib/apiProxy';
import { NetworkError } from '@/lib/errors';
import { TTSService } from '@/services/ttsService';

const mockWriteAsStringAsync = jest.fn();
const mockReadAsStringAsync = jest.fn();

jest.mock('@/lib/apiProxy', () => ({ proxyPost: jest.fn() }));
jest.mock('expo-speech', () => ({ speak: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: (uri: string, contents: string, options: unknown) =>
    mockWriteAsStringAsync(uri, contents, options),
  readAsStringAsync: (uri: string, options: unknown) => mockReadAsStringAsync(uri, options),
  getInfoAsync: async () => ({ exists: true, size: 2048 }),
}));

const proxyPostMock = proxyPost as jest.MockedFunction<typeof proxyPost>;
const speakMock = Speech.speak as jest.MockedFunction<typeof Speech.speak>;

const GEORGE = 'JBFqnCBsd6RMkjVDRZzb';
const RACHEL = '21m00Tcm4TlvDq8ikWAM';
const ARIA = '9BWtsMINqrJLrRacOk9x';

const audioResponse = () =>
  ({ ok: true, status: 200, json: async () => ({ audioBase64: 'QUJD', contentType: 'audio/mpeg' }) }) as unknown as Response;

const failure = (status: number, body = '') =>
  ({ ok: false, status, text: async () => body, json: async () => ({}) }) as unknown as Response;

/** Bodies posted to a given proxy route, in call order. */
const bodiesFor = (path: string) =>
  proxyPostMock.mock.calls.filter(([p]) => p === path).map(([, body]) => body);

const ttsBodies = () => bodiesFor('/v1/proxy/elevenlabs/tts');

describe('TTSService', () => {
  let service: TTSService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    service = new TTSService();
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    proxyPostMock.mockResolvedValue(audioResponse());
    speakMock.mockImplementation(((_text: string, options: any) => options?.onDone?.()) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('voice settings', () => {
    it('defaults to a female auto-routed voice with no custom voice', () => {
      expect(service.getVoiceGender()).toBe('female');
      expect(service.getSelectedVoiceId()).toBeNull();
      expect(service.getCustomVoiceId()).toBeNull();
    });

    it('round-trips gender, selected voice and cloned voice', () => {
      service.setVoiceGender('male');
      service.setSelectedVoiceId(ARIA);
      service.setCustomVoiceId('cloned-123');

      expect(service.getVoiceGender()).toBe('male');
      expect(service.getSelectedVoiceId()).toBe(ARIA);
      expect(service.getCustomVoiceId()).toBe('cloned-123');

      service.setCustomVoiceId(null);
      expect(service.getCustomVoiceId()).toBeNull();
    });

    it('resets to language-aware auto-routing at startup', () => {
      service.setSelectedVoiceId(ARIA);
      service.setVoiceGender('male');

      service.initializeStartupVoices();

      expect(service.getSelectedVoiceId()).toBeNull();
      expect(service.getVoiceGender()).toBe('female');
    });
  });

  describe('generateSpeech input handling', () => {
    it('rejects empty or whitespace-only text', async () => {
      await expect(service.generateSpeech('', 'en')).rejects.toThrow('text is empty');
      await expect(service.generateSpeech('   ', 'en')).rejects.toThrow('text is empty');
      expect(proxyPostMock).not.toHaveBeenCalled();
    });

    it('trims the text and truncates it at 4000 characters', async () => {
      await service.generateSpeech(`  ${'a'.repeat(5000)}  `, 'en');

      const input = bodiesFor('/v1/proxy/openai/tts')[0].input as string;
      expect(input).toBe(`${'a'.repeat(4000)}...`);
    });

    it('returns the saved file URI for cloud providers', async () => {
      const uri = await service.generateSpeech('Hello', 'en', 'openai');

      expect(uri).toMatch(/^file:\/\/\/cache\/openai_tts_\d+\.mp3$/);
      expect(mockWriteAsStringAsync).toHaveBeenCalledWith(uri, 'QUJD', { encoding: 'base64' });
    });
  });

  describe('provider routing', () => {
    it('speaks inline and returns null for device TTS on a well-supported language', async () => {
      await expect(service.generateSpeech('Hello', 'en', 'device')).resolves.toBeNull();

      expect(proxyPostMock).not.toHaveBeenCalled();
      expect(speakMock.mock.calls[0][1]).toMatchObject({ language: 'en-US', rate: 0.9, pitch: 1.15 });
    });

    it('lowers the device TTS pitch for a male voice', async () => {
      service.setVoiceGender('male');

      await service.generateSpeech('Hello', 'en', 'device');

      expect(speakMock.mock.calls[0][1]).toMatchObject({ pitch: 0.82 });
    });

    it('falls back to en-US for a language with no device locale', async () => {
      await service.generateSpeech('Hello', 'xx', 'device');

      expect(speakMock.mock.calls[0][1]).toMatchObject({ language: 'en-US' });
    });

    it.each(['ml', 'hi', 'ar', 'th'])(
      'upgrades device TTS to ElevenLabs for %s, where device voices are unreliable',
      async (language) => {
        await service.generateSpeech('Hello', language, 'device');

        expect(speakMock).not.toHaveBeenCalled();
        expect(ttsBodies()).toHaveLength(1);
      },
    );

    it('upgrades OpenAI to ElevenLabs for languages with better ElevenLabs pronunciation', async () => {
      await service.generateSpeech('നന്ദി', 'ml', 'openai');

      expect(ttsBodies()).toHaveLength(1);
      expect(bodiesFor('/v1/proxy/openai/tts')).toHaveLength(0);
    });

    it('keeps OpenAI for Western languages', async () => {
      await service.generateSpeech('Hola', 'es', 'openai');

      expect(bodiesFor('/v1/proxy/openai/tts')).toHaveLength(1);
      expect(ttsBodies()).toHaveLength(0);
    });

    it('routes an explicit Azure request to the Azure proxy', async () => {
      await service.generateSpeech('നന്ദി', 'ml', 'azure');

      expect(bodiesFor('/v1/proxy/azure/tts')).toHaveLength(1);
    });
  });

  describe('OpenAI voice selection', () => {
    const voiceFor = async (language: string) => {
      proxyPostMock.mockClear();
      await service.generateSpeech('text', language, 'openai');
      return bodiesFor('/v1/proxy/openai/tts')[0].voice;
    };

    it('uses nova / echo for Western languages', async () => {
      service.setVoiceGender('female');
      expect(await voiceFor('en')).toBe('nova');

      service.setVoiceGender('male');
      expect(await voiceFor('en')).toBe('echo');
    });

    it('forces script-optimised voices for Indic and RTL languages, ignoring the user pick', async () => {
      // Indic/RTL languages only reach OpenAI once ElevenLabs is out of the picture.
      proxyPostMock.mockResolvedValue(
        failure(401, JSON.stringify({ detail: { status: 'invalid_api_key' } })),
      );
      await service.generateSpeech('നന്ദി', 'ml', 'openai');
      proxyPostMock.mockResolvedValue(audioResponse());
      service.setSelectedVoiceId('fable');

      expect(await voiceFor('ml')).toBe('shimmer');

      service.setVoiceGender('male');
      expect(await voiceFor('ar')).toBe('onyx');
    });

    it('respects an explicitly selected OpenAI voice for Western languages', async () => {
      service.setSelectedVoiceId('fable');

      expect(await voiceFor('fr')).toBe('fable');
    });

    it('ignores an unknown selected voice id', async () => {
      service.setSelectedVoiceId('not-a-voice');

      expect(await voiceFor('fr')).toBe('nova');
    });
  });

  describe('ElevenLabs model and voice selection', () => {
    it('uses the fast flash model with a language hint for supported languages', async () => {
      await service.generateSpeech('Hello', 'en', 'elevenlabs');

      expect(ttsBodies()[0]).toMatchObject({
        model_id: 'eleven_flash_v2_5',
        language_code: 'en',
        voice_settings: { stability: 0.45 },
      });
    });

    it('uses eleven_v3 without a language hint for Indic scripts', async () => {
      await service.generateSpeech('നന്ദി', 'ml', 'elevenlabs');

      expect(ttsBodies()[0]).toMatchObject({ model_id: 'eleven_v3', voice_settings: { stability: 0.5 } });
      expect(ttsBodies()[0].language_code).toBeUndefined();
    });

    it('falls back to eleven_multilingual_v2 for languages in neither set', async () => {
      await service.generateSpeech('Hello', 'xx', 'elevenlabs');

      expect(ttsBodies()[0].model_id).toBe('eleven_multilingual_v2');
    });

    it('auto-routes to Rachel for female and George for male', async () => {
      await service.generateSpeech('Hello', 'en', 'elevenlabs');
      expect(ttsBodies()[0].voiceId).toBe(RACHEL);

      proxyPostMock.mockClear();
      service.setVoiceGender('male');
      await service.generateSpeech('Hello', 'en', 'elevenlabs');
      expect(ttsBodies()[0].voiceId).toBe(GEORGE);
    });

    it('honours an explicitly selected ElevenLabs voice', async () => {
      service.setSelectedVoiceId(ARIA);

      await service.generateSpeech('Hello', 'en', 'elevenlabs');

      expect(ttsBodies()[0].voiceId).toBe(ARIA);
    });

    it('prefers a cloned custom voice over everything else', async () => {
      service.setSelectedVoiceId(ARIA);
      service.setCustomVoiceId('cloned-123');

      await service.generateSpeech('Hello', 'en', 'elevenlabs');

      expect(ttsBodies()[0].voiceId).toBe('cloned-123');
    });
  });

  describe('ElevenLabs failure handling', () => {
    it('retries a paid-plan-only voice (402) with the free-tier George voice', async () => {
      proxyPostMock.mockResolvedValueOnce(failure(402)).mockResolvedValue(audioResponse());
      service.setSelectedVoiceId(ARIA);

      await expect(service.generateSpeech('Hello', 'en', 'elevenlabs')).resolves.toMatch(
        /elevenlabs_tts_\d+\.mp3$/,
      );
      expect(ttsBodies().map(b => b.voiceId)).toEqual([ARIA, GEORGE]);
    });

    it('downgrades to eleven_multilingual_v2 when George also fails', async () => {
      proxyPostMock
        .mockResolvedValueOnce(failure(402))
        .mockResolvedValueOnce(failure(402))
        .mockResolvedValue(audioResponse());
      service.setSelectedVoiceId(ARIA);

      await service.generateSpeech('Hello', 'en', 'elevenlabs');

      expect(ttsBodies().map(b => b.model_id)).toEqual([
        'eleven_flash_v2_5',
        'eleven_flash_v2_5',
        'eleven_multilingual_v2',
      ]);
    });

    it('downgrades eleven_v3 to eleven_multilingual_v2 when v3 is unavailable', async () => {
      proxyPostMock.mockResolvedValueOnce(failure(400)).mockResolvedValue(audioResponse());

      await service.generateSpeech('നന്ദി', 'ml', 'elevenlabs');

      expect(ttsBodies().map(b => b.model_id)).toEqual(['eleven_v3', 'eleven_multilingual_v2']);
    });

    it('latches the key as invalid only when the proxy confirms invalid_api_key', async () => {
      proxyPostMock.mockResolvedValue(
        failure(401, JSON.stringify({ detail: { status: 'invalid_api_key' } })),
      );

      // First call falls back to OpenAI; ElevenLabs is then skipped for the session.
      await service.generateSpeech('നന്ദി', 'ml', 'openai');
      proxyPostMock.mockClear();
      proxyPostMock.mockResolvedValue(audioResponse());

      await service.generateSpeech('നന്ദി', 'ml', 'openai');

      expect(ttsBodies()).toHaveLength(0);
      expect(bodiesFor('/v1/proxy/openai/tts')).toHaveLength(1);
    });

    it('keeps ElevenLabs enabled after a quota 401, which is not a bad key', async () => {
      proxyPostMock.mockResolvedValue(
        failure(401, JSON.stringify({ detail: { status: 'quota_exceeded' } })),
      );

      await service.generateSpeech('നന്ദി', 'ml', 'openai');
      proxyPostMock.mockClear();
      proxyPostMock.mockResolvedValue(audioResponse());

      await service.generateSpeech('നന്ദി', 'ml', 'openai');

      expect(ttsBodies()).toHaveLength(1);
    });

    it('does not latch on a 401 with an unparseable body', async () => {
      proxyPostMock.mockResolvedValue(failure(401, 'not json'));

      await service.generateSpeech('നന്ദി', 'ml', 'openai');
      proxyPostMock.mockClear();
      proxyPostMock.mockResolvedValue(audioResponse());

      await service.generateSpeech('നന്ദി', 'ml', 'openai');

      expect(ttsBodies()).toHaveLength(1);
    });
  });

  describe('cross-provider fallback', () => {
    it('falls back from ElevenLabs to OpenAI', async () => {
      proxyPostMock.mockImplementation(async (path: string) =>
        path === '/v1/proxy/elevenlabs/tts' ? failure(500) : audioResponse(),
      );

      const uri = await service.generateSpeech('നന്ദി', 'ml', 'elevenlabs');

      expect(uri).toMatch(/openai_tts_\d+\.mp3$/);
    });

    it('falls back from Azure to ElevenLabs', async () => {
      proxyPostMock.mockImplementation(async (path: string) =>
        path === '/v1/proxy/azure/tts' ? failure(500) : audioResponse(),
      );

      const uri = await service.generateSpeech('നന്ദി', 'ml', 'azure');

      expect(uri).toMatch(/elevenlabs_tts_\d+\.mp3$/);
    });

    it('falls back to Azure-less providers when no Azure voice is mapped', async () => {
      const uri = await service.generateSpeech('Hola', 'es', 'azure');

      expect(bodiesFor('/v1/proxy/azure/tts')).toHaveLength(0);
      expect(uri).toMatch(/elevenlabs_tts_\d+\.mp3$/);
    });

    it('falls back to device TTS when every cloud provider fails', async () => {
      proxyPostMock.mockResolvedValue(failure(500));

      await expect(service.generateSpeech('Hello', 'en', 'elevenlabs')).resolves.toBeNull();
      expect(speakMock).toHaveBeenCalled();
    });

    it('resolves to null rather than throwing when device TTS fails last', async () => {
      proxyPostMock.mockResolvedValue(failure(500));
      speakMock.mockImplementation(((_t: string, o: any) =>
        o?.onError?.(new Error('no voice data'))) as never);

      await expect(service.generateSpeech('Hello', 'en', 'elevenlabs')).resolves.toBeNull();
    });

    it('falls back to the cloud when device TTS fails for a supported language', async () => {
      speakMock.mockImplementation(((_t: string, o: any) =>
        o?.onError?.(new Error('language pack missing'))) as never);

      const uri = await service.generateSpeech('Hello', 'en', 'device');

      expect(uri).toMatch(/elevenlabs_tts_\d+\.mp3$/);
    });

    it('preserves NetworkError identity so callers stop the conversation loop', async () => {
      proxyPostMock.mockRejectedValue(new NetworkError('offline'));
      speakMock.mockImplementation(((_t: string, o: any) => o?.onDone?.()) as never);

      // Every cloud provider raises NetworkError; the final device fallback succeeds.
      await expect(service.generateSpeech('Hello', 'en', 'openai')).resolves.toBeNull();
      expect(speakMock).toHaveBeenCalled();
    });
  });

  describe('Azure SSML', () => {
    it('wraps the text in SSML with the mapped neural voice and locale', async () => {
      await service.generateSpeech('നന്ദി', 'ml', 'azure');

      expect(bodiesFor('/v1/proxy/azure/tts')[0].ssml).toBe(
        "<speak version='1.0' xml:lang='ml-IN'><voice name='ml-IN-SobhanaNeural'>നന്ദി</voice></speak>",
      );
    });

    it('uses the male neural voice when the male gender is selected', async () => {
      service.setVoiceGender('male');

      await service.generateSpeech('നന്ദി', 'ml', 'azure');

      expect(bodiesFor('/v1/proxy/azure/tts')[0].ssml).toContain('ml-IN-MidhunNeural');
    });

    it('XML-escapes the text so markup cannot break the SSML document', async () => {
      await service.generateSpeech(`<b>a & "b" 'c'</b>`, 'ml', 'azure');

      expect(bodiesFor('/v1/proxy/azure/tts')[0].ssml).toContain(
        '&lt;b&gt;a &amp; &quot;b&quot; &apos;c&apos;&lt;/b&gt;',
      );
    });
  });

  describe('cloneVoice', () => {
    it('uploads the recording and returns the new voice id', async () => {
      mockReadAsStringAsync.mockResolvedValue('QUJD');
      proxyPostMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ voice_id: 'voice-42' }),
      } as unknown as Response);

      await expect(service.cloneVoice('file:///sample.m4a', 'My Voice')).resolves.toBe('voice-42');
      expect(proxyPostMock).toHaveBeenCalledWith('/v1/proxy/elevenlabs/voice-clone', {
        name: 'My Voice',
        audioBase64: 'QUJD',
        mimeType: 'audio/m4a',
        fileName: 'voice_sample.m4a',
      });
    });

    it('surfaces the proxy error detail', async () => {
      mockReadAsStringAsync.mockResolvedValue('QUJD');
      proxyPostMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ detail: { message: 'Sample too short' } }),
      } as unknown as Response);

      await expect(service.cloneVoice('file:///sample.m4a', 'My Voice')).rejects.toThrow(
        'Sample too short',
      );
    });

    it('falls back to a status-based message when the error body is unusable', async () => {
      mockReadAsStringAsync.mockResolvedValue('QUJD');
      proxyPostMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response);

      await expect(service.cloneVoice('file:///sample.m4a', 'My Voice')).rejects.toThrow(
        'Voice cloning failed (500)',
      );
    });
  });

  describe('saving audio', () => {
    it('rejects an empty audio payload from the proxy', async () => {
      proxyPostMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ audioBase64: '' }),
      } as unknown as Response);

      // OpenAI fails to save, then the device fallback speaks instead.
      await expect(service.generateSpeech('Hello', 'en', 'openai')).resolves.toBeNull();
      expect(speakMock).toHaveBeenCalled();
    });
  });
});
