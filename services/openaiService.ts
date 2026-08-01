import { Platform } from 'react-native';
import { proxyPost } from '@/lib/apiProxy';
import { NetworkError, isNetworkError } from '@/lib/errors';
import { logger } from '@/lib/logger';

// Script-specific seed prompts: bias Whisper toward the correct Unicode block
// so it does not transliterate or fall back to a similar language.
const WHISPER_PROMPTS: Record<string, string> = {
  ml: 'ഇത് മലയാളം ഭാഷയിലുള്ള ഒരു ഓഡിയോ ആണ്.',
  ta: 'இது தமிழ் மொழியில் உள்ள ஒரு ஆடியோ.',
  te: 'ఇది తెలుగు భాషలో ఉన్న ఆడియో.',
  kn: 'ಇದು ಕನ್ನಡ ಭಾಷೆಯಲ್ಲಿರುವ ಆಡಿಯೋ.',
  hi: 'यह हिंदी भाषा में एक ऑडियो है।',
  mr: 'हे मराठी भाषेतील एक ऑडिओ आहे.',
  bn: 'এটি বাংলা ভাষায় একটি অডিও।',
  gu: 'આ ગુજરાતી ભાષામાં એક ઑડિઓ છે.',
  pa: 'ਇਹ ਪੰਜਾਬੀ ਭਾਸ਼ਾ ਵਿੱਚ ਇੱਕ ਆਡੀਓ ਹੈ।',
  ur: 'یہ اردو زبان میں ایک آڈیو ہے۔',
  ar: 'هذا تسجيل صوتي باللغة العربية.',
  fa: 'این یک فایل صوتی به زبان فارسی است.',
  he: 'זהו קובץ שמע בשפה העברית.',
  ne: 'यो नेपाली भाषामा एउटा अडियो हो।',
  si: 'මෙය සිංහල භාෂාවෙන් පටිගත කළ ශ්‍රව්‍ය ගොනුවකි.',
  tl: 'Ito ay isang audio sa wikang Filipino.',
};

// Odia and Assamese are not recognised by Whisper API (returns HTTP 400).
// All other Indic codes — including ml, ne, si — are fully supported.
const WHISPER_UNSUPPORTED_LANGS = new Set(['or', 'as']);

// Filipino uses 'tl' (Tagalog) as the Whisper language code, not ISO 639-2 'fil'.
const WHISPER_LANG_REMAP: Record<string, string> = { fil: 'tl' };

const MIME_TO_EXTENSION: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/webm;codecs=opus': 'webm',
  'audio/ogg': 'ogg',
  'audio/ogg;codecs=opus': 'ogg',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
};

const EXTENSION_TO_MIME: Record<string, string> = {
  wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'audio/webm',
  flac: 'audio/flac', oga: 'audio/ogg',
};

export class OpenAIService {
  private initialized = false;

  /** Kept for call-site compatibility — the real API key now lives server-side. */
  initialize(_apiKey: string) {
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async transcribe(
    audioUri: string,
    language?: string
  ): Promise<{ text: string; detectedLanguage?: string }> {
    try {
      console.log('Preparing audio file for transcription from URI:', audioUri);
      const { base64, mimeType, fileName } = await this.readAudioAsBase64(audioUri);

      const sizeBytes = Math.floor(base64.length * 0.75);
      console.log('Audio file info:', { fileName, mimeType, sizeKB: (sizeBytes / 1024).toFixed(2) + ' KB' });

      if (sizeBytes === 0) throw new Error('Audio file is empty.');
      if (sizeBytes > 6 * 1024 * 1024) throw new Error('Audio recording is too long for this request.');

      let whisperLangCode: string | null = null;
      let whisperPrompt: string | undefined;
      if (language && language !== 'auto') {
        const isoCode = language.split('-')[0].toLowerCase();
        const remapped = WHISPER_LANG_REMAP[isoCode] || isoCode;
        whisperLangCode = WHISPER_UNSUPPORTED_LANGS.has(remapped) ? null : remapped;
        whisperPrompt = WHISPER_PROMPTS[isoCode] ?? WHISPER_PROMPTS[remapped];
        const langNote = whisperLangCode ?? `prompt-only(${remapped})`;
        console.log(`🎤 Whisper: ${langNote}${whisperPrompt ? ' +prompt' : ''}`);
      } else {
        console.log('🎤 Whisper: auto-detecting language');
      }

      console.log('📡 Sending to Whisper transcription proxy...');
      const response = await proxyPost('/v1/proxy/openai/transcribe', {
        audioBase64: base64,
        fileName,
        mimeType,
        language: whisperLangCode ?? undefined,
        prompt: whisperPrompt,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err: any = new Error(errorData.error || `Whisper API error: ${response.status}`);
        err.status = response.status;
        throw err;
      }

      const data = await response.json();

      console.log('✅ Transcription successful');
      console.log(`🗣️ Detected language: ${data.detectedLanguage || 'unknown'}`);
      console.log(`📝 Transcribed text: "${data.text}"`);
      console.log(`📊 Text length: ${data.text?.length || 0} chars`);

      return { text: data.text, detectedLanguage: data.detectedLanguage };
    } catch (error: any) {
      logger.error('Error transcribing audio', error);

      // Bug fix: a raw fetch-level failure (offline, DNS, CORS, backend down) threw
      // a bare `TypeError: Failed to fetch`, which matched none of the branches
      // below (they only checked for the *string* "network") and fell through to
      // the generic "Failed to transcribe audio: Failed to fetch" message. That
      // message was indistinguishable from any other soft failure, so the caller
      // (RealtimeTranslationService) treated it as retryable and looped back into
      // Listening mode instead of stopping. isNetworkError() catches this case
      // (and our own wrapped NetworkError) before it can be mislabeled.
      if (isNetworkError(error)) {
        throw new NetworkError('Network error. Please check your internet connection.', error);
      } else if (error.status === 401 || error.message?.includes('API key')) {
        throw new Error('Transcription service is temporarily unavailable. Please try again shortly.');
      } else if (error.status === 429 || error.message?.includes('quota') || error.message?.includes('rate limit')) {
        throw new Error('Transcription quota exceeded or rate limited. Please try again later.');
      } else if (error.status === 400) {
        throw new Error(`Bad request to transcription service: ${error.message}`);
      } else {
        throw new Error(`Failed to transcribe audio: ${error.message || 'Unknown error'}`);
      }
    }
  }

  /** Read a local/blob audio URI and return it as base64 + resolved mime type + file name. */
  private async readAudioAsBase64(
    audioUri: string
  ): Promise<{ base64: string; mimeType: string; fileName: string }> {
    const response = await fetch(audioUri);
    const blob = await response.blob();

    let mimeType = blob.type || 'audio/webm';
    if (Platform.OS !== 'web') {
      const uriExt = audioUri.split('.').pop()?.toLowerCase() || 'wav';
      mimeType = EXTENSION_TO_MIME[uriExt] ?? mimeType;
    }

    const extension = MIME_TO_EXTENSION[mimeType.split(';')[0].toLowerCase()] || 'webm';
    const fileName = `recording_${Date.now()}.${extension}`;

    const base64 = await new Promise<string>((resolve, reject) => {
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

    return { base64, mimeType, fileName };
  }
}

export const openaiService = new OpenAIService();
