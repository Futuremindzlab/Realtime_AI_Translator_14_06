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
   * @param language  ISO 639-1 language code, or 'auto' for auto-detection
   */
  async transcribe(
    audioUri: string,
    language?: string,
  ): Promise<{ text: string; detectedLanguage?: string }> {
    if (!this.context) {
      throw new Error('[WhisperService] Not initialized');
    }

    const { promise } = this.context.transcribe(audioUri, {
      language: language === 'auto' || !language ? undefined : language,
      maxLen: 0,
      bestOf: 2,
      beamSize: 1,
      temperature: 0,
    });

    const result = await promise;
    const text = result.result?.trim() ?? '';
    return { text };
  }

  /**
   * Try on-device transcription first; fall back to OpenAI Whisper cloud API
   * if the local model isn't ready yet, on web, or the result is empty.
   * The tiny on-device model can silently return empty text for languages it
   * handles poorly (e.g. some Indic scripts) — in that case we retry in cloud.
   */
  async transcribeWithFallback(
    audioUri: string,
    language?: string,
  ): Promise<{ text: string; detectedLanguage?: string }> {
    if (this.isReady()) {
      try {
        const result = await this.transcribe(audioUri, language);
        if (result.text.trim()) return result;
        // On-device returned empty — cloud may do better for this language
        console.log('[WhisperService] On-device returned empty, trying cloud...');
      } catch (err) {
        console.warn('[WhisperService] On-device transcription error, falling back:', err);
      }
    }

    // Cloud fallback — import lazily to avoid circular dependency
    const { openaiService } = await import('./openaiService');
    console.log('[WhisperService] Using cloud Whisper fallback');
    return openaiService.transcribe(audioUri, language);
  }
}

export const whisperService = new WhisperService();
