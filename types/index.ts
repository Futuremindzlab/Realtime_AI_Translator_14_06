export type UserRole = 'USER' | 'OWNER';

export interface ConversationHistory {
  id: string;
  user_id: string;
  timestamp: string;
  source_language: string;
  target_language: string;
  source_text: string;
  translated_text: string;
  source_audio_url?: string;
  translated_audio_url?: string;
  conversation_mode: boolean;
  favorite?: boolean;
  created_at: string;
}

export interface UserSettings {
  user_id: string;
  default_source_language: string;
  default_target_language: string;
  tts_provider: 'inworld' | 'elevenlabs' | 'openai' | 'device' | 'azure';
  translation_provider?: 'openai' | 'device';
  conversation_mode_default: boolean;
  custom_voice_id?: string;
  voice_gender?: 'male' | 'female';
  selected_voice_id?: string;
  updated_at: string;
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export interface TranslationRequest {
  audioUri: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslationResult {
  sourceText: string;
  translatedText: string;
  translatedAudioUrl?: string;
}
