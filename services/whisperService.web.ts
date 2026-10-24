// Web stub — whisper.rn is native-only (TurboModuleRegistry unavailable in browser).
// On web, all transcription goes directly to OpenAI Whisper cloud API.

class WhisperService {
  async initialize(): Promise<boolean> { return false; }
  isReady(): boolean { return false; }

  async transcribeWithFallback(
    audioUri: string,
    language?: string,
    // Signature kept identical to the native implementation (see
    // whisperService.ts) so callers don't need platform-specific branching.
    // Unused here — isReady() is always false on web, so this always goes
    // to cloud regardless of what's passed.
    _useOnDevice?: boolean,
  ): Promise<{ text: string; detectedLanguage?: string; engine: 'on-device' | 'cloud' }> {
    const { openaiService } = await import('./openaiService');
    const result = await openaiService.transcribe(audioUri, language);
    return { ...result, engine: 'cloud' };
  }
}

export const whisperService = new WhisperService();
