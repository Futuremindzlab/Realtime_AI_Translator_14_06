import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
const MODEL_PATH = `${FileSystem.documentDirectory}ggml-tiny.bin`;

// whisper.rn is a native-only module — do not import at top level
// It will crash on web because TurboModuleRegistry is not available there
type WhisperContext = Awaited<ReturnType<typeof import('whisper.rn')['initWhisper']>>;

class WhisperService {
  private context: WhisperContext | null = null;
  private initPromise: Promise<boolean> | null = null;

  /**
   * Download the tiny model (39 MB) if not cached, then initialize whisper.rn.
   * Safe to call multiple times — returns the same promise.
   * On web, always returns false (uses cloud fallback).
   */
  async initialize(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    if (this.context) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const { initWhisper } = await import('whisper.rn');

        // Download model if not already on disk
        const info = await FileSystem.getInfoAsync(MODEL_PATH);
        if (!info.exists) {
          console.log('[WhisperService] Downloading ggml-tiny model…');
          await FileSystem.downloadAsync(MODEL_URL, MODEL_PATH);
          console.log('[WhisperService] Model downloaded');
        }

        this.context = await initWhisper({ filePath: MODEL_PATH });
        console.log('✅ [WhisperService] On-device Whisper ready (tiny model)');
        return true;
      } catch (err) {
        console.warn('[WhisperService] Init failed, cloud fallback active:', err);
        this.initPromise = null; // allow retry next time
        return false;
      }
    })();

    return this.initPromise;
  }

  isReady(): boolean {
    return this.context !== null;
  }

  /**
   * Transcribe audio on-device using whisper.rn.
   * @param audioUri  Local file URI (WAV 16 kHz mono recommended)
   * @param language  ISO 639-1 language code ('ml', 'hi', etc.) — never pass 'auto' here
   */
  async transcribe(
    audioUri: string,
    language?: string,
  ): Promise<{ text: string; detectedLanguage?: string }> {
    if (!this.context) {
      throw new Error('[WhisperService] Not initialized');
    }

    const langCode = (language && language !== 'auto') ? language : undefined;

    // Seed Whisper with a script-appropriate prompt for Indic languages so it
    // stays in the correct script and doesn't fall back to transliteration.
    const initialPrompts: Record<string, string> = {
      ml: 'ഇത് മലയാളം ഭാഷയിലുള്ള ഒരു ഓഡിയോ ആണ്.',
      ta: 'இது தமிழ் மொழியில் உள்ள ஒரு ஆடியோ.',
      te: 'ఇది తెలుగు భాషలో ఉన్న ఆడియో.',
      kn: 'ಇದು ಕನ್ನಡ ಭಾಷೆಯಲ್ಲಿರುವ ಆಡಿಯೋ.',
      hi: 'यह हिंदी भाषा में एक ऑडियो है।',
      mr: 'हे मराठी भाषेतील एक ऑडिओ आहे.',
      bn: 'এটি বাংলা ভাষায় একটি অডিও।',
      gu: 'આ ગુજરાતી ભાષામાં એક ઑડિઓ છે.',
      pa: 'ਇਹ ਪੰਜਾਬੀ ਭਾਸ਼ਾ ਵਿੱਚ ਇੱਕ ਆਡੀਓ ਹੈ।',
      ar: 'هذا تسجيل صوتي باللغة العربية.',
      ur: 'یہ اردو زبان میں ایک آڈیو ہے۔',
      ne: 'यो नेपाली भाषामा एउटा अडियो हो।',
      si: 'මෙය සිංහල භාෂාවෙන් පටිගත කළ ශ්‍රව්‍ය ගොනුවකි.',
    };
    const initialPrompt = langCode ? (initialPrompts[langCode] ?? undefined) : undefined;

    const { promise } = this.context.transcribe(audioUri, {
      language: langCode,
      maxLen: 0,
      bestOf: 5,
      beamSize: 5,
      temperature: 0,
      ...(initialPrompt ? { prompt: initialPrompt } : {}),
    });

    const result = await promise;
    const text = result.result?.trim() ?? '';
    return { text };
  }

  /**
   * Try on-device transcription first; fall back to OpenAI Whisper cloud API
   * if the local model isn't ready yet, on web, or the result is empty.
   *
   * We always skip the tiny on-device model for:
   *   - Auto-detect: tiny model cannot reliably detect Indic languages and
   *     frequently returns Tamil or Hindi for other Dravidian input.
   *   - All Indic + RTL languages: the tiny model has poor accuracy for
   *     Malayalam, Kannada, Telugu, Gujarati, Punjabi, Urdu, Arabic, etc.
   *     OpenAI cloud Whisper handles these significantly better.
   */
  async transcribeWithFallback(
    audioUri: string,
    language?: string,
  ): Promise<{ text: string; detectedLanguage?: string }> {
    const isAutoDetect = !language || language === 'auto';

    // Languages where the tiny on-device model performs poorly.
    // Cloud Whisper is significantly more accurate for these scripts.
    const CLOUD_ONLY_LANGS = new Set([
      'ml', 'ta', 'te', 'kn', 'hi', 'mr', 'bn', 'gu', 'pa', 'ur', 'ne', 'si',
      'ar', 'fa', 'he',
    ]);
    const isoCode = language?.split('-')[0]?.toLowerCase() ?? '';
    const forceCloud = isAutoDetect || CLOUD_ONLY_LANGS.has(isoCode);

    if (!forceCloud && this.isReady()) {
      try {
        const result = await this.transcribe(audioUri, language);
        if (result.text.trim()) return result;
        console.log('[WhisperService] On-device returned empty, trying cloud...');
      } catch (err) {
        console.warn('[WhisperService] On-device transcription error, falling back:', err);
      }
    }

    if (forceCloud && !isAutoDetect) {
      console.log(`[WhisperService] Routing ${isoCode} directly to cloud Whisper (better accuracy)`);
    } else if (isAutoDetect) {
      console.log('[WhisperService] Auto-detect mode — using cloud Whisper');
    }

    // Cloud fallback — import lazily to avoid circular dependency
    const { openaiService } = await import('./openaiService');
    return openaiService.transcribe(audioUri, language);
  }
}

export const whisperService = new WhisperService();
