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
 * `reason === 'No speech detected'` gets exactly one courtesy retry before
 * handing control to the other person — not zero (a person who paused before
 * speaking, or whose first attempt was glitched, shouldn't be dropped
 * immediately), and not unbounded (a person who's genuinely silent shouldn't
 * block the conversation forever). `retryAlreadyUsedThisTurn` is that cap: a
 * second consecutive 'No speech detected' failure for the same person's turn
 * hands over, since one retry has already given the benefit of the doubt.
 *
 * This used to be gated on `interruptedByAppStateBlip` (only retry if an
 * AppState background blip — an OS-level audio-focus hiccup, mic-privacy
 * indicator, etc. — landed during the recording) instead of retrying every
 * 'No speech detected' once unconditionally. Real diagnostics logs disproved
 * that gate: on some Android devices that blip fires on EVERY recording
 * start, success or failure alike (two back-to-back successful turns showed
 * the identical blip right before a failing one) — so it was never actually
 * predictive of anything; `interruptedByAppStateBlip` was true on every turn
 * and the gate was accidentally always open on those devices, while devices
 * where it stayed genuinely rare would have under-retried real silence
 * differently for no good reason. Retrying once regardless of the flag is
 * both simpler and strictly more patient — exactly what a person who spoke
 * but was cut short, or started a beat late, needs — while the flag is kept
 * only to choose an honest message, never to gate the retry itself.
 */
export function classifyTurnFailure(
  reason: string | undefined,
  interruptedByAppStateBlip: boolean | undefined,
  retryAlreadyUsedThisTurn: boolean
): TurnFailureOutcome {
  if (reason === 'No speech detected') {
    if (!retryAlreadyUsedThisTurn) {
      return {
        kind: 'retry',
        message: interruptedByAppStateBlip ? 'Recording was interrupted' : 'No speech detected yet',
      };
    }
    return { kind: 'silence-handover' };
  }
  return { kind: 'retry', message: interruptedByAppStateBlip ? 'Recording was interrupted' : (reason || 'Turn failed') };
}
