import { Platform } from 'react-native';

export class OpenAIService {
  private apiKey: string | null = null;

  initialize(apiKey: string) {
    this.apiKey = apiKey;
  }

  isInitialized(): boolean {
    return this.apiKey !== null;
  }

async transcribe(
  audioUri: string,
  language?: string
): Promise<{ text: string; detectedLanguage?: string }> {
  // Use the API key directly from your client config or process.env
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key not found. Please check your configuration.');
  }

  try {
    console.log('Preparing audio file for transcription from URI:', audioUri);
    const audioFile = await this.prepareAudioFile(audioUri);
    
    console.log('Audio file info:', {
      name: audioFile.name,
      type: audioFile.type,
      sizeKB: (audioFile.size / 1024).toFixed(2) + ' KB'
    });

    if (audioFile.size === 0) throw new Error('Audio file is empty.');
    if (audioFile.size > 25 * 1024 * 1024) throw new Error('Audio file is too large (max 25MB).');

    // --- REPLACED SDK CALL WITH DIRECT FETCH ---
    console.log('Sending to Whisper API via Direct Fetch...');

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

    // Resolve the language code we'll send to Whisper, independent of FormData build.
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
      console.log(`🎤 Whisper: auto-detecting language`);
    }

    // Helper: build a FormData for one Whisper attempt.
    // withLang: include the language field (false for prompt-only retry).
    const buildFormData = (withLang: boolean): FormData => {
      const fd = new FormData();
      if (Platform.OS === 'web') {
        fd.append('file', audioFile, audioFile.name);
      } else {
        const cleanUri = Platform.OS === 'android' && !audioUri.startsWith('file://')
          ? `file://${audioUri}`
          : audioUri;
        const uriExt = cleanUri.split('.').pop()?.toLowerCase() || 'wav';
        const extToMime: Record<string, string> = {
          wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
          mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'audio/webm',
          flac: 'audio/flac', oga: 'audio/ogg',
        };
        const fileMime = extToMime[uriExt] ?? 'audio/wav';
        fd.append('file', { uri: cleanUri, name: `recording.${uriExt}`, type: fileMime } as any);
      }
      fd.append('model', 'whisper-1');
      fd.append('response_format', 'verbose_json');
      fd.append('temperature', '0');
      if (withLang && whisperLangCode) fd.append('language', whisperLangCode);
      if (whisperPrompt) fd.append('prompt', whisperPrompt);
      return fd;
    };

    console.log('📡 Sending to Whisper API...');

    let response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: buildFormData(true),
    });

    // Safety net: if the language code was rejected (HTTP 400), retry without it.
    // This handles ultra-rare codes that Whisper doesn't recognise at runtime.
    if (!response.ok && response.status === 400 && whisperLangCode) {
      console.warn(`🎤 Whisper rejected language code "${whisperLangCode}" — retrying prompt-only`);
      response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: buildFormData(false),
      });
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
    }

    const transcription = await response.json();
    // -------------------------------------------

    console.log('✅ Transcription successful');
    console.log(`🗣️ Detected language: ${transcription.language || 'unknown'}`);
    console.log(`📝 Transcribed text: "${transcription.text}"`);
    console.log(`📊 Text length: ${transcription.text?.length || 0} chars`);

    return {
      text: transcription.text,
      detectedLanguage: transcription.language,
    };

  } catch (error: any) {
    console.error('Error transcribing audio:', error);

    if (error.status === 401 || error.message?.includes('API key') || error.message?.includes('Incorrect API key')) {
      throw new Error('Invalid OpenAI API key. Please check your API key in the .env file and ensure it starts with "sk-".');
    } else if (error.status === 429 || error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('OpenAI API quota exceeded or rate limited. Please check your billing at platform.openai.com.');
    } else if (error.status === 400) {
      if (error.message?.includes('file format') || error.message?.includes('Unrecognized file format')) {
        throw new Error(`Audio format not supported. The recording format may be incompatible. Error: ${error.message}`);
      }
      throw new Error(`Bad request to OpenAI API: ${error.message}`);
    } else if (error.message?.includes('network') || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      throw new Error('Network error. Please check your internet connection.');
    } else {
      throw new Error(`Failed to transcribe audio: ${error.message || 'Unknown error'}`);
    }
  }
}

  async prepareAudioFile(audioUri: string): Promise<File> {
    try {
      const response = await fetch(audioUri);
      const blob = await response.blob();

      const mimeType = blob.type || 'audio/webm';
      console.log('Original blob MIME type:', mimeType);
      console.log('Blob size:', blob.size);

      const extension = this.getExtensionFromMimeType(mimeType);
      const fileName = `recording_${Date.now()}.${extension}`;

      console.log('Creating File with:', { fileName, mimeType, size: blob.size });

      const file = Object.assign(blob, {
        name: fileName,
        lastModified: Date.now(),
      }) as File;

      console.log('File created:', {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified
      });

      return file;
    } catch (error) {
      console.error('Error preparing audio file:', error);
      throw new Error('Failed to prepare audio file for transcription');
    }
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const mimeToExtension: Record<string, string> = {
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

    const normalizedMime = mimeType.split(';')[0].toLowerCase();
    return mimeToExtension[normalizedMime] || mimeToExtension[mimeType.toLowerCase()] || 'webm';
  }
}

export const openaiService = new OpenAIService();
