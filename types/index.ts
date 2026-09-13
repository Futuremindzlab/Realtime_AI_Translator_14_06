export type UserRole = 'USER' | 'OWNER';

export interface ConversationHistory {
  id: string;
  user_id: string;
  timestamp: string;
  source_language: string;
  target_language: string;
  source_text: string;
  translated_text: string;
  // S3 object keys, not URLs — presigned GET URLs expire, so a fresh one is
  // minted on demand via dynamoService.getAudioUrl() rather than stored here.
  source_audio_key?: string;
  translated_audio_key?: string;
  conversation_mode: boolean;
  favorite?: boolean;
  created_at: string;
}

// Subscription tier — see backend/src/lib/entitlement.mjs for the authoritative
// definition. 'basic' < 'plus' < 'live' (each higher tier includes the ones below).
// Billing-controlled: the backend never accepts this from a PUT/PATCH /v1/settings
// body, so treat it as read-only on the client — there is no setPlan() call by design.
export type SubscriptionPlan = 'basic' | 'plus' | 'live';

export interface UserSettings {
  user_id: string;
  default_source_language: string;
  default_target_language: string;
  tts_provider: 'elevenlabs' | 'openai' | 'device' | 'azure';
  translation_provider?: 'openai' | 'device';
  conversation_mode_default: boolean;
  custom_voice_id?: string;
  voice_gender?: 'male' | 'female';
  selected_voice_id?: string;
  /** Defaults to 'basic' server-side if absent — always present in practice once
   *  fetched from GET /v1/settings, optional here only so locally-constructed
   *  offline/default objects aren't forced to fabricate a value. */
  plan?: SubscriptionPlan;
  /** Razorpay subscription ID backing `plan`, when `plan` isn't 'basic' — set
   *  by the backend (createSubscription/verify/webhook), never by the client.
   *  Absent for a 'basic' user or one whose plan came from adminSetPlan(). */
  razorpay_subscription_id?: string;
  /** Mirrors Razorpay's subscription lifecycle: 'active' | 'pending' |
   *  'cancel_requested' | 'cancelled' | 'halted' | 'completed' | 'paused', etc.
   *  See backend/src/handlers/billing.mjs for the authoritative state machine. */
  razorpay_subscription_status?: string;
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
