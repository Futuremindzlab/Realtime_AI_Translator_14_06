// Web stub — whisper.rn is native-only (TurboModuleRegistry unavailable in browser).
// On web, all transcription goes directly to OpenAI Whisper cloud API.

class WhisperService {
  async initialize(): Promise<boolean> { return false; }
  isReady(): boolean { return false; }

  async transcribeWithFallback(
    audioUri: string,
    language?: string,
  ): Promise<{ text: string; detectedLanguage?: string }> {
    const { openaiService } = await import('./openaiService');
    return openaiService.transcribe(audioUri, language);
  }
}

export const whisperService = new WhisperService();
