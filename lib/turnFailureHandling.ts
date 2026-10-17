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
 *
 * Real report: on some Android devices/OS versions, that same AppState
 * 'background' blip fires on EVERY recording start (OEM mic-privacy
 * indicator / audio-focus negotiation) regardless of whether the recording
 * is actually fine — two back-to-back successful turns can show the exact
 * same blip as a failing one right after. There, `interruptedByAppStateBlip`
 * is true on every turn, so it can no longer distinguish "this failure was
 * caused by the blip" from "this is genuine silence" — and always retrying
 * the same person on it turned repeated genuine silence into a dead-end
 * retry loop that exhausts the retry budget and forces a restart, worse
 * than the pre-fix silence-handover for that case. `blipRetryAlreadyUsedThisTurn`
 * caps the benefit of the doubt at one retry per person-turn: a second
 * consecutive 'No speech detected' failure hands over regardless of the
 * blip flag, since by then repetition has already disproven "this was a
 * one-off glitch."
 */
export function classifyTurnFailure(
  reason: string | undefined,
  interruptedByAppStateBlip: boolean | undefined,
  blipRetryAlreadyUsedThisTurn: boolean
): TurnFailureOutcome {
  if (reason === 'No speech detected') {
    if (interruptedByAppStateBlip && !blipRetryAlreadyUsedThisTurn) {
      return { kind: 'retry', message: 'Recording was interrupted' };
    }
    return { kind: 'silence-handover' };
  }
  return { kind: 'retry', message: interruptedByAppStateBlip ? 'Recording was interrupted' : (reason || 'Turn failed') };
}
