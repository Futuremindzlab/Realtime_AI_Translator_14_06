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
  /** True once the user has completed the onboarding flow (use-case picker +
   *  privacy consent + trial/paywall intro) — AuthGate shows OnboardingFlow
   *  instead of the app until this is true. Defaults to false server-side. */
  onboarding_completed?: boolean;
  /** Self-reported reason for using the app, collected once during onboarding
   *  (e.g. 'travel', 'business', 'learning', 'family', 'other'). Not used for
   *  gating anything — personalization/analytics only. */
  use_case?: string | null;
  updated_at: string;
}

/** Response shape for GET /v1/usage/trial and POST /v1/usage/trial/consume —
 *  see backend/src/lib/trialLimits.mjs for the authoritative logic. A 'plus'/
 *  'live' subscriber gets back `{ unlimited: true }` and nothing else, since
 *  the 7-day/10-translation/5-conversation trial only ever applies to 'basic'. */
export interface TrialStatus {
  plan: SubscriptionPlan;
  unlimited: boolean;
  trial_started?: boolean;
  trial_start_date?: string;
  expired?: boolean;
  days_remaining?: number;
  caps?: { translation: number; conversation: number };
  used?: { translation: number; conversation: number };
}

/** Result of POST /v1/usage/trial/consume specifically. */
export interface TrialConsumeResult {
  allowed: boolean;
  unlimited?: boolean;
  reason?: 'trial_expired' | 'trial_limit_reached';
  kind?: 'translation' | 'conversation';
  used?: number;
  remaining?: number;
  cap?: number;
  trial_start_date?: string;
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
