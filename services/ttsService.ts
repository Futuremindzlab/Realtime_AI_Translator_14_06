import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

// expo-file-system is native-only. On web, saveAudioResponseToFile() uses
// URL.createObjectURL() instead, so FileSystem is never called.
const FileSystem: any = Platform.OS === 'web'
  ? { cacheDirectory: '', writeAsStringAsync: async () => {}, readAsStringAsync: async () => '', getInfoAsync: async () => ({ exists: true, size: 1 }) }
  : require('expo-file-system/legacy');

export type TTSProvider = 'inworld' | 'elevenlabs' | 'openai' | 'device';

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

  private inworldApiKey: string | null = null;
  private elevenlabsApiKey: string | null = null;
  private elevenlabsKeyValid = true;
  private openaiApiKey: string | null = null;
  private customVoiceId: string | null = null;
  private voiceGender: VoiceGender = 'female';
  private selectedVoiceId: string | null = null;

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
    if (!this.elevenlabsApiKey) {
      throw new Error('ElevenLabs API key not set');
    }

    console.log(`🎤 Starting voice cloning for "${name}" from ${audioUri}`);

    // Read the audio file as base64
    const base64Audio = await FileSystem.readAsStringAsync(audioUri, {
      encoding: 'base64',
    });

    // Convert base64 to a blob for FormData
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: 'audio/m4a' });

    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', 'Voice cloned from Realtime AI Translator app');
    formData.append('files', audioBlob, 'voice_sample.m4a');

    const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': this.elevenlabsApiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.detail?.message || `Voice cloning failed (${response.status})`);
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

  initializeInworld(apiKey: string) {
    this.inworldApiKey = apiKey;
  }

  initializeElevenLabs(apiKey: string) {
    this.elevenlabsApiKey = apiKey;
    this.elevenlabsKeyValid = true; // Reset on new key
    console.log(`🔊 ElevenLabs initialized (key: ${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)})`);
  }

  initializeOpenAI(apiKey: string) {
    this.openaiApiKey = apiKey;
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
   * Returns a local file URI for cloud providers (openai / elevenlabs / inworld)
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
    const hasElevenLabs = !!(this.elevenlabsApiKey && this.elevenlabsKeyValid);
    const hasOpenAI = !!this.openaiApiKey;

    // Determine effective provider.
    // CRITICAL: auto-upgrade BEFORE the 'device' short-circuit so that Indian/Arabic
    // languages are never sent to device TTS (Android falls back to system language
    // — e.g. Spanish — when the target language pack is not installed).
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

    // No cloud keys → device TTS fallback
    if (!hasOpenAI && !hasElevenLabs) {
      console.log('🔊 No cloud TTS key — using device TTS');
      await this.generateWithDevice(processedText, language);
      return null;
    }

    console.log(`🔊 TTS: provider=${effectiveProvider}, lang=${language}, chars=${processedText.length}`);

    try {
      switch (effectiveProvider) {
        case 'elevenlabs':
          return await this.generateWithElevenLabs(processedText, language);
        case 'openai':
          return await this.generateWithOpenAI(processedText, language);
        default:
          return await this.generateWithOpenAI(processedText, language);
      }
    } catch (primaryError) {
      console.error(`❌ TTS failed with ${effectiveProvider}:`, primaryError);

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

    await new Promise<void>((resolve, reject) => {
      Speech.speak(text, {
        language: locale,
        rate: 0.9,
        pitch,
        onDone: resolve,
        onError: (err) => reject(new Error(`Device TTS error: ${err.message}`)),
        onStopped: resolve, // treat stop as done (user may have interrupted)
      });
    });
  }

  private async generateWithOpenAI(text: string, language: string): Promise<string> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not set. Please add it in settings.');
    }

    const voice = this.getOpenAIVoiceForLanguage(language);
    console.log(`🔊 OpenAI TTS: voice=${voice}, lang=${language}`);

    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1-hd',  // HD model: better pronunciation for all languages
          voice,
          input: text,
          speed: 1.0,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI TTS failed with status ${response.status}`);
      }

      // Save audio to file
      const fileUri = await this.saveAudioResponseToFile(response, 'openai_tts');
      console.log('OpenAI TTS audio saved to:', fileUri);
      return fileUri;
    } catch (error) {
      console.error('OpenAI TTS error:', error);
      throw new Error(`OpenAI TTS failed: ${error}`);
    }
  }

  private async generateWithInworld(text: string, language: string): Promise<string> {
    if (!this.inworldApiKey) {
      throw new Error('Inworld API key not set.');
    }

    console.log('Attempting Inworld TTS generation...');

    try {
      const response = await fetch('https://api.inworld.ai/v1/text-to-speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.inworldApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          language,
          voice: this.getInworldVoiceForLanguage(language),
          format: 'mp3',
        }),
      });

      if (!response.ok) {
        throw new Error(`Inworld TTS failed with status ${response.status}`);
      }

      const fileUri = await this.saveAudioResponseToFile(response, 'inworld_tts');
      console.log('Inworld TTS audio saved to:', fileUri);
      return fileUri;
    } catch (error) {
      console.error('Inworld TTS error:', error);
      throw new Error(`Inworld TTS failed: ${error}`);
    }
  }

  private async generateWithElevenLabs(text: string, language: string): Promise<string> {
    if (!this.elevenlabsApiKey) {
      throw new Error('ElevenLabs API key not set.');
    }

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
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${requestVoiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.elevenlabsApiKey!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          this.elevenlabsKeyValid = false;
          console.error('❌ ElevenLabs 401 — key invalid, disabling auto-switch');
        }
        const errBody = await response.text().catch(() => '');
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

      return await this.saveAudioResponseToFile(response, 'elevenlabs_tts');
    } catch (error) {
      console.error('ElevenLabs TTS error:', error);
      throw new Error(`ElevenLabs TTS failed: ${error}`);
    }
  }

  private async saveAudioResponseToFile(response: Response, prefix: string): Promise<string> {
    try {
      const blob = await response.blob();
      console.log(`🔊 Audio blob size: ${(blob.size / 1024).toFixed(1)} KB`);

      if (blob.size === 0) {
        throw new Error('TTS returned empty audio');
      }

      // Web: create an object URL directly from the blob — no file system needed
      if (Platform.OS === 'web') {
        const objectUrl = URL.createObjectURL(blob);
        console.log(`✅ Audio object URL created (web)`);
        return objectUrl;
      }

      // Native (iOS/Android): save base64 to cache directory
      const base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            const commaIndex = reader.result.indexOf(',');
            resolve(commaIndex >= 0 ? reader.result.substring(commaIndex + 1) : reader.result);
          } else {
            reject(new Error('FileReader returned non-string result'));
          }
        };
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });

      const fileName = `${prefix}_${Date.now()}.mp3`;
      const fileUri = (FileSystem.cacheDirectory || '') + fileName;

      await FileSystem.writeAsStringAsync(fileUri, base64String, {
        encoding: 'base64',
      });

      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      console.log(`✅ Audio saved: ${fileUri} (${fileInfo.exists ? `${((fileInfo as any).size / 1024).toFixed(1)} KB` : 'NOT FOUND'})`);

      return fileUri;
    } catch (error) {
      console.error('❌ Error saving audio to file:', error);
      throw new Error(`Failed to save audio: ${error}`);
    }
  }

  private getOpenAIVoiceForLanguage(language: string): string {
    const knownIds = TTSService.OPENAI_VOICES.map(v => v.id);
    if (this.selectedVoiceId && knownIds.includes(this.selectedVoiceId)) {
      return this.selectedVoiceId;
    }
    // For Indian/Indic scripts: onyx (male) has a deeper, more authoritative tone
    // that carries Indic phonology well; shimmer (female) is clear and enunciates
    // consonant clusters better than nova for these scripts.
    if (TTSService.INDIC_LANGUAGES.has(language) || TTSService.RTL_LANGUAGES.has(language)) {
      return this.voiceGender === 'male' ? 'onyx' : 'shimmer';
    }
    // Western/European/East Asian: nova (female, warm) and echo (male, mellow)
    return this.voiceGender === 'male' ? 'echo' : 'nova';
  }

  private getInworldVoiceForLanguage(language: string): string {
    const voiceMap: Record<string, string> = {
      en: 'en-US-Standard-A',
      hi: 'hi-IN-Standard-A',
      ta: 'ta-IN-Standard-A',
      te: 'te-IN-Standard-A',
      kn: 'kn-IN-Standard-A',
      ml: 'ml-IN-Standard-A',
      mr: 'mr-IN-Standard-A',
      bn: 'bn-IN-Standard-A',
      gu: 'gu-IN-Standard-A',
      pa: 'pa-IN-Standard-A',
      ur: 'ur-IN-Standard-A',
      es: 'es-ES-Standard-A',
      fr: 'fr-FR-Standard-A',
      de: 'de-DE-Standard-A',
      it: 'it-IT-Standard-A',
      pt: 'pt-BR-Standard-A',
      ru: 'ru-RU-Standard-A',
      ja: 'ja-JP-Standard-A',
      ko: 'ko-KR-Standard-A',
      zh: 'cmn-CN-Standard-A',
      ar: 'ar-XA-Standard-A',
      tr: 'tr-TR-Standard-A',
      th: 'th-TH-Standard-A',
      vi: 'vi-VN-Standard-A',
      id: 'id-ID-Standard-A',
      nl: 'nl-NL-Standard-A',
      pl: 'pl-PL-Standard-A',
      uk: 'uk-UA-Standard-A',
      cs: 'cs-CZ-Standard-A',
      fil: 'fil-PH-Standard-A',
      sv: 'sv-SE-Standard-A',
      da: 'da-DK-Standard-A',
      no: 'nb-NO-Standard-A',
      fi: 'fi-FI-Standard-A',
      el: 'el-GR-Standard-A',
      hu: 'hu-HU-Standard-A',
      ro: 'ro-RO-Standard-A',
      sk: 'sk-SK-Standard-A',
      bg: 'bg-BG-Standard-A',
      sr: 'sr-RS-Standard-A',
      he: 'he-IL-Standard-A',
      ca: 'ca-ES-Standard-A',
    };
    return voiceMap[language] || 'en-US-Standard-A';
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
  private getElevenLabsVoiceForLanguage(language: string): string {
    const knownIds = TTSService.ELEVENLABS_VOICES.map(v => v.id);
    if (this.selectedVoiceId && knownIds.includes(this.selectedVoiceId)) {
      return this.selectedVoiceId;  // explicit user selection wins
    }
    // George is the only free-tier-compatible voice — handles all 70+ languages on eleven_v3
    return 'JBFqnCBsd6RMkjVDRZzb';
  }
}

export const ttsService = new TTSService();
