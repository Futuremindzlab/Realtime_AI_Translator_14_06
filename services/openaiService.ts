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
    
    const formData = new FormData();

    if (Platform.OS === 'web') {
      // Web: pass the actual File/Blob object
      formData.append('file', audioFile, audioFile.name);
    } else {
      // Native (iOS/Android): use React Native's { uri, name, type } format
      const cleanUri = Platform.OS === 'android' && !audioUri.startsWith('file://')
        ? `file://${audioUri}`
        : audioUri;
      // Derive format from the actual recorded URI so the extension/MIME matches
      // the file content. audioService records .wav; sending a mismatched name
      // (e.g. .m4a) causes Whisper to reject it as "Invalid File Format".
      const uriExt = cleanUri.split('.').pop()?.toLowerCase() || 'wav';
      const extToMime: Record<string, string> = {
        wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
        mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'audio/webm',
        flac: 'audio/flac', oga: 'audio/ogg',
      };
      const fileMime = extToMime[uriExt] ?? 'audio/wav';
      formData.append('file', {
        uri: cleanUri,
        name: `recording.${uriExt}`,
        type: fileMime,
      } as any);
    }

    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json'); // 🔧 Changed to get language detection
    formData.append('temperature', '0'); // 🔧 Enable for more accurate transcription

    // When we know the expected language, tell Whisper to improve accuracy
    // (like Google Translate — once languages are set, constrain detection)
    if (language && language !== 'auto') {
      formData.append('language', language);
      console.log(`🎤 Whisper language hint: ${language}`);
    } else {
      console.log(`🎤 Whisper: auto-detecting language`);
    }

    console.log('📡 Sending to Whisper API...');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        // DO NOT set 'Content-Type': 'multipart/form-data', fetch handles the boundary automatically
      },
      body: formData,
    });

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
