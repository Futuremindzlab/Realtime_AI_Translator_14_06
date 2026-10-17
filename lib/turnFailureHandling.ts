/**
 * Decides how a failed conversation-mode turn should be handled. Kept
 * dependency-free (same reasoning as lib/proxyErrors.ts) so it's directly
 * unit-testable — services/RealtimeTranslationService.ts, which actually
 * drives the conversation loop, pulls in @sentry/react-native transitively,
 * which ships ESM Jest can't parse under this project's Babel config.
 */

export type TurnFailureOutcome =
  | { kind: 'silence-handover' }
  | { kind: 'retry'; message: string };

/**
 * `reason === 'No speech detected'` covers two different underlying causes
 * that used to be handled identically:
 *   - A person genuinely staying silent — handed to the other person
 *     immediately, with a "No input from Person X" notice. Expected,
 *     designed-for behavior.
 *   - A recording glitched by an AppState background blip (OS-level audio-
 *     focus hiccup, mic-privacy indicator, etc. — see
 *     audioService.hadAppStateBlipSince), where the person likely DID speak
 *     but Whisper hallucinated a short caption from the corrupted audio.
 *     Treating this as silence silently dropped a real turn behind a
 *     misleading "no input" message with no chance to retry.
 * `interruptedByAppStateBlip` tells the two apart: only genuine silence
 * hands control to the other person; a blip-glitched turn retries the same
 * person instead, with an honest "Recording was interrupted" message.
 */
export function classifyTurnFailure(
  reason: string | undefined,
  interruptedByAppStateBlip: boolean | undefined
): TurnFailureOutcome {
  if (reason === 'No speech detected' && !interruptedByAppStateBlip) {
    return { kind: 'silence-handover' };
  }
  return { kind: 'retry', message: interruptedByAppStateBlip ? 'Recording was interrupted' : (reason || 'Turn failed') };
}
