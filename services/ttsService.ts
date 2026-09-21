import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { proxyPost } from '@/lib/apiProxy';
import { isNetworkError } from '@/lib/errors';

// expo-file-system is native-only. On web, saveBase64Audio() uses
// URL.createObjectURL() instead, so FileSystem is never called.
const FileSystem: any = Platform.OS === 'web'
  ? { cacheDirectory: '', writeAsStringAsync: async () => {}, readAsStringAsync: async () => '', getInfoAsync: async () => ({ exists: true, size: 1 }) }
  : require('expo-file-system/legacy');

export type TTSProvider = 'elevenlabs' | 'openai' | 'device' | 'azure';

export type VoiceGender = 'male' | 'female';

export interface VoiceOption {
  id: string;
  label: string;
  desc: string;
  gender: 'male' | 'female' | 'neutral';
}

export class TTSService {
  // All six OpenAI TTS voices with display labels.
  // Nova/Echo = default for Western languages; Shimmer/Onyx = auto for Indian & Arabic.
  static readonly OPENAI_VOICES: VoiceOption[] = [
    { id: 'nova',    label: 'Nova',    desc: 'Female · Warm · Western & European',        gender: 'female'  },
    { id: 'shimmer', label: 'Shimmer', desc: 'Female · Clear · Indian & Arabic scripts',  gender: 'female'  },
    { id: 'alloy',   label: 'Alloy',   desc: 'Neutral · Versatile · All languages',       gender: 'neutral' },
    { id: 'echo',    label: 'Echo',    desc: 'Male · Mellow · Western & European',        gender: 'male'    },
    { id: 'fable',   label: 'Fable',   desc: 'Male · Expressive · British accent',        gender: 'male'    },
    { id: 'onyx',    label: 'Onyx',    desc: 'Male · Deep · Indian & Arabic scripts',     gender: 'male'    },
  ];

  // ElevenLabs premade voices — classic voices available on ALL plan tiers (free + paid).
  // IMPORTANT: Aria (9BWt…) is a Voice Library voice requiring a paid subscription (HTTP 402
  // on free tier). Auto-routing uses Rachel (female) and George (male) — both classic premades.
  // Aria and Adam are shown in Settings for manual selection by users on paid plans.
  static readonly ELEVENLABS_VOICES: VoiceOption[] = [
    { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', desc: 'Female · American · Default for all languages incl. Indian', gender: 'female' },
    { id: '9BWtsMINqrJLrRacOk9x', label: 'Aria',   desc: 'Female · Versatile · Paid plan required',                    gender: 'female' },
    { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George', desc: 'Male · British · Default for all languages incl. Indian',    gender: 'male'   },
    { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam',   desc: 'Male · Deep · Alternative for Indian & Arabic scripts',      gender: 'male'   },
  ];

  // Azure Cognitive Speech has native ml-IN neural voices. Not auto-preferred —
  // ElevenLabs (eleven_v3) genuinely supports Malayalam natively too and remains
  // the default — but Azure is available as a manual provider choice in Settings.
  static readonly AZURE_VOICE_MAP: Record<string, { female: string; male: string }> = {
    ml: { female: 'ml-IN-SobhanaNeural', male: 'ml-IN-MidhunNeural' },
  };

  // Provider API keys live server-side (backend AI proxy) — the client never holds them.
  // This latch flips false only when the proxy positively confirms the server's
  // ElevenLabs key is invalid, so we stop retrying it for the rest of the session.
  private elevenlabsKeyValid = true;
  private customVoiceId: string | null = null;
  private voiceGender: VoiceGender = 'female';
  private selectedVoiceId: string | null = null;

  // Device TTS voice, pinned per locale once resolved — see resolveDeviceVoiceId().
  private deviceVoiceCache: Record<string, string | null> = {};

  setSelectedVoiceId(id: string | null) {
    this.selectedVoiceId = id;
  }

  getSelectedVoiceId(): string | null {
    return this.selectedVoiceId;
  }

  setVoiceGender(gender: VoiceGender) {
    this.voiceGender = gender;
    console.log(`🔊 Voice gender set: ${gender}`);
  }

  getVoiceGender(): VoiceGender {
    return this.voiceGender;
  }

  setCustomVoiceId(voiceId: string | null) {
    this.customVoiceId = voiceId;
    if (voiceId) {
      console.log(`🎤 Custom voice set: ${voiceId}`);
    } else {
      console.log('🎤 Custom voice cleared, using default voices');
    }
  }

  getCustomVoiceId(): string | null {
    return this.customVoiceId;
  }

  /**
   * Clone a voice using ElevenLabs Instant Voice Cloning.
   * Requires 30-60 seconds of clear speech audio.
   * Returns the new voice ID.
   */
  async cloneVoice(audioUri: string, name: string): Promise<string> {
    console.log(`🎤 Starting voice cloning for "${name}" from ${audioUri}`);

    // Read the audio file as base64 and hand it to the backend proxy —
    // the real ElevenLabs key lives server-side, never on the client.
    const base64Audio = await FileSystem.readAsStringAsync(audioUri, {
      encoding: 'base64',
    });

    const response = await proxyPost('/v1/proxy/elevenlabs/voice-clone', {
      name,
      audioBase64: base64Audio,
      mimeType: 'audio/m4a',
      fileName: 'voice_sample.m4a',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.detail?.message || error?.error || `Voice cloning failed (${response.status})`);
    }

    const data = await response.json();
    const voiceId = data.voice_id;
    console.log(`✅ Voice cloned successfully: ${voiceId}`);
    return voiceId;
  }

  /**
   * Called at app startup to force-configure 3 default voice slots:
   *   Indian Female → Aria, Indian Male → George, Foreign → Aria/George
   * Resets any stale selectedVoiceId so auto-routing is always active at launch.
   * AuthContext / Settings may override voice_gender and selectedVoiceId once
   * user preferences load from DynamoDB.
   */
  initializeStartupVoices(): void {
    this.selectedVoiceId = null;  // ensure language-aware auto-routing is active
    this.voiceGender = 'female';  // default gender until settings load
    console.log(
      '🔊 Startup voices: ElevenLabs=George (free tier) · OpenAI=Shimmer/Nova for female · OpenAI=Onyx/Echo for male'
    );
  }

  // Indic-script languages: Whisper prompt-only mode; ElevenLabs eleven_v3; George voice (male)
  private static readonly INDIC_LANGUAGES = new Set([
    'ml', 'ta', 'te', 'kn', 'hi', 'mr', 'bn', 'gu', 'pa', 'ne', 'si',
  ]);

  // Right-to-left script languages: ElevenLabs eleven_v3; George voice (male)
  private static readonly RTL_LANGUAGES = new Set([
    'ar', 'fa', 'he', 'ur',
  ]);

  // Languages where device TTS is unreliable or unavailable on most phones.
  // Automatically upgrade to ElevenLabs (or OpenAI) when one of these is the target.
  private static readonly ELEVENLABS_PREFERRED_LANGUAGES = new Set([
    // All Indian Indic-script languages
    'ml', 'ta', 'te', 'kn', 'hi', 'mr', 'bn', 'gu', 'pa', 'ur', 'ne', 'si',
    // Middle Eastern / RTL
    'ar', 'fa', 'he',
    // Other languages with poor device TTS coverage
    'th', 'vi', 'sw', 'fil',
  ]);

  /**
   * Languages supported by eleven_flash_v2_5 + language_code (ISO 639-1).
   * Fast model (~75ms latency, 0.5 credits/char).
   * NOTE: hi/ta/ar were tested in Flash but reverted to V3 — classic premade voices
   * (Aria, George) are more reliable with eleven_v3 for Indic/Arabic scripts.
   */
  private static readonly FLASH_SUPPORTED_LANGUAGES = new Set([
    'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh',
    'tr', 'pl', 'nl', 'sv', 'da', 'no', 'fi', 'el', 'cs', 'hu',
    'ro', 'bg', 'sk', 'hr', 'id', 'ms', 'fil', 'uk', 'ca',
  ]);

  /**
   * Languages handled by eleven_v3 — 70+ languages including all Indian scripts.
   * eleven_v3 auto-detects language from Unicode script; do NOT send language_code.
   * hi/ta/ar restored here (reverted from Flash) to match the Feb working baseline.
   */
  private static readonly V3_SUPPORTED_LANGUAGES = new Set([
    'ml', 'ta', 'te', 'kn', 'hi', 'mr', 'bn', 'gu', 'pa', 'ur',
    'ar', 'fa', 'he', 'th', 'vi', 'sw', 'ne', 'si',
  ]);

  /**
   * Generate speech for the given text.
   *
   * Returns a local file URI for cloud providers (openai / elevenlabs / azure)
   * that must be passed to audioService.playAudio().
   *
   * Returns null for the 'device' provider — expo-speech speaks inline and
   * no file URI is produced. Callers must guard: `if (uri) { playAudio(uri); }`
   */
  async generateSpeech(
    text: string,
    language: string,
    provider: TTSProvider = 'openai'
  ): Promise<string | null> {
    // Validate and truncate text if needed
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot generate speech: text is empty');
    }

    const MAX_CHARS = 4000;
    let processedText = text.trim();

    if (processedText.length > MAX_CHARS) {
      processedText = processedText.substring(0, MAX_CHARS) + '...';
    }

    const needsBetterTTS = TTSService.ELEVENLABS_PREFERRED_LANGUAGES.has(language);
    // Provider keys live server-side now — "has X" just means "the server hasn't told
    // us this key is confirmed invalid yet". Any other unavailability (missing key,
    // quota, network) surfaces as a thrown error and is handled by the fallback chains below.
    const hasElevenLabs = this.elevenlabsKeyValid;
    const hasOpenAI = true;

    // Determine effective provider.
    // CRITICAL: auto-upgrade BEFORE the 'device' short-circuit so that Indian/Arabic
    // languages are never sent to device TTS (Android falls back to system language
    // — e.g. Spanish — when the target language pack is not installed).
    // NOTE: Azure is available as a manually-selectable provider (see generateWithAzure /
    // AZURE_VOICE_MAP) but is not auto-preferred — ElevenLabs (eleven_v3) genuinely
    // supports Malayalam natively, so it remains the default/preferred engine.
    let effectiveProvider = provider;

    if (provider === 'device' && needsBetterTTS) {
      if (hasElevenLabs) {
        effectiveProvider = 'elevenlabs';
        console.log(`🔊 Auto-switching device → ElevenLabs for ${language}`);
      } else if (hasOpenAI) {
        effectiveProvider = 'openai';
        console.log(`🔊 Auto-switching device → OpenAI for ${language}`);
      }
      // No cloud keys: fall through to device TTS (user's explicit choice, best we can do)
    } else if (provider === 'openai' && needsBetterTTS && hasElevenLabs) {
      effectiveProvider = 'elevenlabs';
      console.log(`🔊 Auto-switching openai → ElevenLabs for ${language} (better pronunciation)`);
    }

    // Device TTS: only reached when still 'device' after auto-upgrade.
    // If device TTS fails (language pack not installed), fall back to cloud.
    if (effectiveProvider === 'device') {
      try {
        await this.generateWithDevice(processedText, language);
        return null;
      } catch (deviceErr) {
        console.warn(`⚠️ Device TTS failed for "${language}", falling back to cloud:`, deviceErr);
        if (hasElevenLabs) {
          try { return await this.generateWithElevenLabs(processedText, language); } catch {}
        }
        if (hasOpenAI) {
          try { return await this.generateWithOpenAI(processedText, language); } catch {}
        }
        // Nothing worked — swallow the error so translation still completes
        console.error('❌ All TTS providers failed; audio skipped');
        return null;
      }
    }

    console.log(`🔊 TTS: provider=${effectiveProvider}, lang=${language}, chars=${processedText.length}`);

    try {
      switch (effectiveProvider) {
        case 'azure':
          return await this.generateWithAzure(processedText, language);
        case 'elevenlabs':
          return await this.generateWithElevenLabs(processedText, language);
        case 'openai':
          return await this.generateWithOpenAI(processedText, language);
        default:
          return await this.generateWithOpenAI(processedText, language);
      }
    } catch (primaryError) {
      console.error(`❌ TTS failed with ${effectiveProvider}:`, primaryError);

      if (effectiveProvider === 'azure' && hasElevenLabs) {
        try {
          console.log('🔊 Fallback: ElevenLabs TTS...');
          return await this.generateWithElevenLabs(processedText, language);
        } catch (elevenErr) {
          console.error('❌ ElevenLabs TTS fallback also failed:', elevenErr);
        }
      }

      if (effectiveProvider !== 'openai' && hasOpenAI) {
        try {
          console.log('🔊 Fallback: OpenAI TTS...');
          return await this.generateWithOpenAI(processedText, language);
        } catch (openaiErr) {
          console.error('❌ OpenAI TTS fallback also failed:', openaiErr);
        }
      }

      // Final fallback: device TTS (may not support all languages; swallow failures)
      console.log('🔊 Final fallback: device TTS');
      try {
        await this.generateWithDevice(processedText, language);
      } catch (deviceErr) {
        console.error('❌ Device TTS also failed; audio skipped:', deviceErr);
      }
      return null;
    }
  }

  /**
   * Speak text inline using the device's built-in TTS engine.
   * iOS uses AVSpeechSynthesizer; Android uses TextToSpeech.
   * Zero network latency, zero API cost.
   */
  private async generateWithDevice(text: string, language: string): Promise<void> {
    // Map ISO 639-1 → BCP-47 locale for expo-speech
    const localeMap: Record<string, string> = {
      en: 'en-US',  hi: 'hi-IN',  ta: 'ta-IN',  te: 'te-IN',  kn: 'kn-IN',
      ml: 'ml-IN',  mr: 'mr-IN',  bn: 'bn-IN',  gu: 'gu-IN',  pa: 'pa-IN',
      ur: 'ur-PK',  es: 'es-ES',  fr: 'fr-FR',  de: 'de-DE',  it: 'it-IT',
      pt: 'pt-BR',  ru: 'ru-RU',  ja: 'ja-JP',  ko: 'ko-KR',  zh: 'zh-CN',
      ar: 'ar-SA',  tr: 'tr-TR',  th: 'th-TH',  vi: 'vi-VN',  id: 'id-ID',
      nl: 'nl-NL',  pl: 'pl-PL',  sv: 'sv-SE',  da: 'da-DK',  fi: 'fi-FI',
      el: 'el-GR',  cs: 'cs-CZ',  hu: 'hu-HU',  ro: 'ro-RO',  uk: 'uk-UA',
      he: 'he-IL',  fa: 'fa-IR',  ms: 'ms-MY',  fil: 'fil-PH', sk: 'sk-SK',
      bg: 'bg-BG',  hr: 'hr-HR',  sr: 'sr-RS',  ca: 'ca-ES',  sw: 'sw-KE',
      no: 'nb-NO',  ne: 'ne-NP',  si: 'si-LK',
    };

    const locale = localeMap[language] || 'en-US';
    console.log(`🔊 Device TTS: locale=${locale}, len=${text.length}`);

    // Approximate gender via pitch: female=1.15 (slightly higher), male=0.82 (slightly lower)
    const pitch = this.voiceGender === 'male' ? 0.82 : 1.15;

    // Bug fix: passing only `language` (a locale, not a voice) left the OS free
    // to pick whichever installed TTS voice it wanted for that locale on each
    // call. On Android, with more than one voice/engine installed for the same
    // locale, that pick isn't guaranteed stable across calls — reported as
    // conversation mode's translated voice sounding consistent for the first
    // couple of turns, then abruptly different ("random voice") on a later
    // one. Pin a specific voice identifier, resolved once per locale and
    // reused for every subsequent call, so it can't drift mid-conversation.
    const voiceId = await this.resolveDeviceVoiceId(locale);

    await new Promise<void>((resolve, reject) => {
      Speech.speak(text, {
        language: locale,
        ...(voiceId ? { voice: voiceId } : {}),
        rate: 0.9,
        pitch,
        onDone: resolve,
        onError: (err) => reject(new Error(`Device TTS error: ${err.message}`)),
        onStopped: resolve, // treat stop as done (user may have interrupted)
      });
    });
  }

  /**
   * Resolve (and cache) a single, stable voice identifier for a given locale so
   * repeated calls use the exact same installed voice instead of leaving the
   * pick up to the OS each time. Falls back to undefined (OS default) if the
   * device reports no matching voice or the lookup itself fails — device TTS
   * must never throw just because voice enumeration isn't available.
   */
  private async resolveDeviceVoiceId(locale: string): Promise<string | undefined> {
    if (locale in this.deviceVoiceCache) {
      return this.deviceVoiceCache[locale] ?? undefined;
    }
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      const languagePrefix = locale.split('-')[0].toLowerCase();
      const matches = voices.filter(v => v.language?.toLowerCase().startsWith(languagePrefix));

      // Deterministic pick: prefer Enhanced quality, then sort by identifier so
      // the same voice is chosen every time regardless of the array's original
      // (possibly OS-session-dependent) order.
      matches.sort((a, b) => {
        if (a.quality !== b.quality) return a.quality === 'Enhanced' ? -1 : 1;
        return a.identifier.localeCompare(b.identifier);
      });

      const chosen = matches[0]?.identifier ?? null;
      this.deviceVoiceCache[locale] = chosen;
      console.log(`🔊 Device TTS: pinned voice for ${locale} = ${chosen ?? '(OS default — no match found)'}`);
      return chosen ?? undefined;
    } catch (err) {
      console.warn(`⚠️ Device TTS: voice enumeration failed for ${locale}, using OS default:`, err);
      this.deviceVoiceCache[locale] = null;
      return undefined;
    }
  }

  private async generateWithOpenAI(text: string, language: string): Promise<string> {
    const voice = this.getOpenAIVoiceForLanguage(language);
    console.log(`🔊 OpenAI TTS: voice=${voice}, lang=${language}`);

    try {
      const response = await proxyPost('/v1/proxy/openai/tts', {
        model: 'tts-1-hd', // HD model: better pronunciation for all languages
        voice,
        input: text,
        speed: 1.0,
        response_format: 'mp3',
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`OpenAI TTS failed with status ${response.status}: ${errBody.substring(0, 200)}`);
      }

      const data = await response.json();
      const fileUri = await this.saveBase64Audio(data.audioBase64, data.contentType || 'audio/mpeg', 'openai_tts');
      console.log('OpenAI TTS audio saved to:', fileUri);
      return fileUri;
    } catch (error) {
      console.error('OpenAI TTS error:', error);
      // Preserve NetworkError identity instead of flattening it into a generic
      // Error string — callers need isNetworkError() to still recognize it.
      if (isNetworkError(error)) throw error;
      throw new Error(`OpenAI TTS failed: ${error}`);
    }
  }

  private async generateWithAzure(text: string, language: string): Promise<string> {
    const voiceName = this.getAzureVoiceForLanguage(language);
    const locale = voiceName.split('-').slice(0, 2).join('-'); // e.g. 'ml-IN-SobhanaNeural' → 'ml-IN'

    // SSML requires XML-escaping — unlike the JSON bodies used by OpenAI/ElevenLabs above.
    const escapedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const ssml = `<speak version='1.0' xml:lang='${locale}'><voice name='${voiceName}'>${escapedText}</voice></speak>`;

    console.log(`🔊 Azure TTS: voice=${voiceName}, lang=${language}`);

    try {
      const response = await proxyPost('/v1/proxy/azure/tts', { ssml });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Azure TTS failed with status ${response.status}: ${errBody.substring(0, 200)}`);
      }

      const data = await response.json();
      const fileUri = await this.saveBase64Audio(data.audioBase64, data.contentType || 'audio/mpeg', 'azure_tts');
      console.log('Azure TTS audio saved to:', fileUri);
      return fileUri;
    } catch (error) {
      console.error('Azure TTS error:', error);
      if (isNetworkError(error)) throw error;
      throw new Error(`Azure TTS failed: ${error}`);
    }
  }

  private getAzureVoiceForLanguage(language: string): string {
    const pair = TTSService.AZURE_VOICE_MAP[language];
    if (!pair) {
      // Azure is manually selectable as a general provider but only has a voice
      // mapped for Malayalam today; the caller's catch block falls back to
      // ElevenLabs/OpenAI/device for any other language.
      throw new Error(`No Azure voice mapped for language "${language}"`);
    }
    return this.voiceGender === 'male' ? pair.male : pair.female;
  }

  private async generateWithElevenLabs(text: string, language: string): Promise<string> {
    // Use custom cloned voice if available, otherwise pick by language + gender
    const voiceId = this.customVoiceId || this.getElevenLabsVoiceForLanguage(language);

    // Three-tier model selection:
    // 1. eleven_flash_v2_5      — fast; Western + EA languages (en/es/fr/de/ja/ko/zh …)
    // 2. eleven_v3              — Indian scripts + Arabic/Persian/Hebrew/Thai (hi/ta/ml/ar …)
    // 3. eleven_multilingual_v2 — fallback if v3/flash fails on this account plan
    const useFlash = TTSService.FLASH_SUPPORTED_LANGUAGES.has(language);
    const useV3    = !useFlash && TTSService.V3_SUPPORTED_LANGUAGES.has(language);
    const model    = useFlash ? 'eleven_flash_v2_5' : useV3 ? 'eleven_v3' : 'eleven_multilingual_v2';

    const body: Record<string, any> = { text, model_id: model };

    if (useFlash) {
      // flash v2_5: accepts language_code hint + extended voice_settings
      body.voice_settings = {
        stability: 0.45,
        similarity_boost: 0.78,
        style: 0.35,
        use_speaker_boost: true,
      };
      body.language_code = language;
    } else {
      // v3 and multilingual_v2: auto-detect language from Unicode script; do NOT send language_code
      // v3 stability must be 0.0, 0.5, or 1.0 (TTD presets)
      body.voice_settings = {
        stability: 0.5,
        similarity_boost: 0.78,
        style: 0.35,
        use_speaker_boost: true,
      };
    }

    console.log(`🔊 ElevenLabs TTS: model=${model}, voice=${voiceId}, lang=${language}`);

    // Free-tier fallback voice — George is the only voice confirmed on all plan tiers.
    const FREE_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

    const callAPI = async (requestVoiceId: string, requestBody: Record<string, any>) => {
      const response = await proxyPost('/v1/proxy/elevenlabs/tts', {
        voiceId: requestVoiceId,
        ...requestBody,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');

        // ElevenLabs returns HTTP 401 for BOTH an invalid API key AND a used-up monthly
        // character quota (and possibly other transient reasons) — only distinguishable via
        // detail.status in the body. Default to the SAFE side: only disable auto-routing for
        // the session when we can positively confirm it's actually an invalid key. Any other
        // 401 (quota_exceeded, an unrecognized reason, or an unparseable body) just fails this
        // one request and falls through to OpenAI/device, same as any other transient error —
        // a false "key invalid" latch is worse than one extra retried request.
        if (response.status === 401) {
          let status: string | undefined;
          try {
            status = JSON.parse(errBody)?.detail?.status;
          } catch {
            // Unparseable body — status stays undefined, treated as non-key-invalid below.
          }
          if (status === 'invalid_api_key') {
            this.elevenlabsKeyValid = false;
            console.error('❌ ElevenLabs 401 — key invalid, disabling auto-switch');
          } else {
            console.error(`❌ ElevenLabs 401 — ${status || 'unrecognized reason'} (not a confirmed bad key); falling back for this request only`);
          }
        }
        console.error(`❌ ElevenLabs ${response.status}: ${errBody.substring(0, 200)}`);
        throw Object.assign(new Error(`ElevenLabs TTS failed (${response.status})`), { status: response.status });
      }

      return response;
    };

    const mv2Body = {
      text: body.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.78, style: 0.35, use_speaker_boost: true },
    };

    try {
      let response: Response;
      try {
        response = await callAPI(voiceId, body);
      } catch (err: any) {
        const status: number = err?.status ?? 0;

        // 402 = paid feature / voice not available on this plan.
        // If we were using a non-default voice, retry with the free-tier George voice first.
        if (status === 402 && voiceId !== FREE_VOICE_ID) {
          console.log(`🔊 Voice ${voiceId} requires paid plan (402) — retrying with George (free tier)`);
          try {
            response = await callAPI(FREE_VOICE_ID, body);
          } catch (georgeErr: any) {
            // George also failed → fall through to model downgrade
            console.warn('🔊 George also failed, trying eleven_multilingual_v2...');
            response = await callAPI(FREE_VOICE_ID, mv2Body);
          }
        } else if (useV3) {
          // eleven_v3 unavailable on this plan → eleven_multilingual_v2 (widely supported)
          console.log('🔊 eleven_v3 failed, retrying with eleven_multilingual_v2...');
          response = await callAPI(voiceId !== FREE_VOICE_ID && status === 402 ? FREE_VOICE_ID : voiceId, mv2Body);
        } else if (useFlash) {
          // Flash failed (voice may not support this model) → eleven_multilingual_v2
          console.log('🔊 eleven_flash_v2_5 failed, retrying with eleven_multilingual_v2...');
          response = await callAPI(voiceId, mv2Body);
        } else {
          throw err;
        }
      }

      const data = await response.json();
      return await this.saveBase64Audio(data.audioBase64, data.contentType || 'audio/mpeg', 'elevenlabs_tts');
    } catch (error) {
      console.error('ElevenLabs TTS error:', error);
      if (isNetworkError(error)) throw error;
      throw new Error(`ElevenLabs TTS failed: ${error}`);
    }
  }

  /** Save a base64-encoded audio payload (from the AI proxy) to a playable URI. */
  private async saveBase64Audio(base64: string, contentType: string, prefix: string): Promise<string> {
    try {
      if (!base64) {
        throw new Error('TTS returned empty audio');
      }

      // Web: decode to a Blob and hand back an object URL — no file system needed
      if (Platform.OS === 'web') {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: contentType });
        const objectUrl = URL.createObjectURL(blob);
        console.log(`✅ Audio object URL created (web)`);
        return objectUrl;
      }

      // Native (iOS/Android): the proxy already gives us base64 — write it straight to disk
      const fileName = `${prefix}_${Date.now()}.mp3`;
      const fileUri = (FileSystem.cacheDirectory || '') + fileName;

      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: 'base64' });

      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      console.log(`✅ Audio saved: ${fileUri} (${fileInfo.exists ? `${((fileInfo as any).size / 1024).toFixed(1)} KB` : 'NOT FOUND'})`);

      return fileUri;
    } catch (error) {
      console.error('❌ Error saving audio to file:', error);
      throw new Error(`Failed to save audio: ${error}`);
    }
  }

  private getOpenAIVoiceForLanguage(language: string): string {
    // For Indian/Arabic scripts always use script-optimized voices regardless of selectedVoiceId.
    // nova/echo have significantly worse phoneme coverage for Devanagari, Malayalam, Arabic, etc.
    // This enforces strict Indian/RTL voice selection — cannot be overridden by user voice pick.
    if (TTSService.INDIC_LANGUAGES.has(language) || TTSService.RTL_LANGUAGES.has(language)) {
      return this.voiceGender === 'male' ? 'onyx' : 'shimmer';
    }
    // For Western/European/East Asian: respect user's explicit voice selection.
    const knownIds = TTSService.OPENAI_VOICES.map(v => v.id);
    if (this.selectedVoiceId && knownIds.includes(this.selectedVoiceId)) {
      return this.selectedVoiceId;
    }
    return this.voiceGender === 'male' ? 'echo' : 'nova';
  }

  /**
   * Voice selection for ElevenLabs.
   *
   * Auto-routing always uses George — the only voice confirmed to work on the ElevenLabs
   * free tier. Rachel (21m00…) and Aria (9BWt…) return HTTP 402 on free accounts.
   *
   * Startup defaults (Issue 4):
   *   Indian Female  → George (ElevenLabs free tier; use OpenAI shimmer for female TTS)
   *   Indian Male    → George (ElevenLabs free tier, confirmed working with eleven_v3)
   *   Foreign Female → George (ElevenLabs free tier; use OpenAI nova for female TTS)
   *   Foreign Male   → George
   *
   * For true female voice: set TTS provider to 'openai' (shimmer/nova) or select Aria/Rachel
   * in Settings on a paid ElevenLabs plan.
   */
  private getElevenLabsVoiceForLanguage(_language: string): string {
    const knownIds = TTSService.ELEVENLABS_VOICES.map(v => v.id);
    if (this.selectedVoiceId && knownIds.includes(this.selectedVoiceId)) {
      return this.selectedVoiceId;
    }
    // Gender-aware auto-routing using free-tier classic premades.
    // Rachel (female) is a classic premade available on the free tier.
    // If Rachel returns HTTP 402, callAPI's 402-handler retries automatically with George.
    return this.voiceGender === 'male'
      ? 'JBFqnCBsd6RMkjVDRZzb'   // George — confirmed free tier, all scripts
      : '21m00Tcm4TlvDq8ikWAM';  // Rachel — free tier; 402 → auto-fallback to George
  }
}

export const ttsService = new TTSService();
