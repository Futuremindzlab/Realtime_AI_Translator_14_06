// Pure conversation-mode turn/language logic, deliberately kept free of any
// other imports (unlike RealtimeTranslationService.ts, which pulls in
// audio/network/storage side effects that make it impractical to unit test
// as a whole) so this — the exact logic behind a real report of
// conversation mode "picking a different language" a few turns in — can be
// exercised directly and thoroughly.

export interface TurnLanguageState {
  isPersonATurn: boolean;
  currentSourceLanguage: string;
  currentTargetLanguage: string;
}

/**
 * Pure computation of the next turn's speaker + source/target languages,
 * given only the two fixed "original" languages set once at conversation
 * start (RealtimeTranslationService.originalSourceLanguage /
 * originalTargetLanguage, resolved once from 'auto' — see
 * resolvePersonAAutoSourceLanguage below — and never mutated again).
 *
 * This is the entire mechanism behind who-speaks-what for every turn after
 * the first: Person A always speaks originalSourceLanguage and hears
 * originalTargetLanguage; Person B always speaks originalTargetLanguage and
 * hears originalSourceLanguage. It does not, and must not, depend on
 * anything detected during a turn (e.g. Whisper's per-turn detected
 * language) — see RealtimeTranslationService.processConversationTurn's
 * comment on why only Person A's very first turn ever touches
 * originalSourceLanguage.
 */
export function computeNextTurnLanguages(
  wasPersonATurn: boolean,
  originalSourceLanguage: string,
  originalTargetLanguage: string,
): TurnLanguageState {
  const isPersonATurn = !wasPersonATurn;
  return isPersonATurn
    ? { isPersonATurn, currentSourceLanguage: originalSourceLanguage, currentTargetLanguage: originalTargetLanguage }
    : { isPersonATurn, currentSourceLanguage: originalTargetLanguage, currentTargetLanguage: originalSourceLanguage };
}

/**
 * Pure resolution of Person A's source language on their very first turn,
 * when the conversation was started with sourceLanguage: 'auto'. Whisper's
 * detected language wins unless it exactly matches the target language
 * (impossible — you can't translate X to X — so that combination means
 * Whisper misidentified the input), in which case English is the safe
 * default so the turn can still proceed with whatever was transcribed
 * rather than being discarded.
 */
export function resolvePersonAAutoSourceLanguage(
  detectedLanguage: string | undefined,
  targetLanguage: string,
): string {
  if (detectedLanguage && detectedLanguage !== targetLanguage) return detectedLanguage;
  return 'en';
}
