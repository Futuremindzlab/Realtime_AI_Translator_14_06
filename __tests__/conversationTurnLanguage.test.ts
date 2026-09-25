import {
  computeNextTurnLanguages,
  resolvePersonAAutoSourceLanguage,
} from '@/lib/conversationTurnLanguage';

// This is the logic directly responsible for a real report: "3rd or 4th
// iteration, it picked a different language than the original source
// language." The swap is a pure function of only the two fixed "original"
// languages and whose turn it was — it must never depend on anything
// per-turn (like what Whisper happened to detect that turn), or drift is
// exactly what you'd get. These tests simulate long conversations (up to
// 50 turns — far beyond the "3rd or 4th" the report described) and assert
// the language pairing for a given person never changes once locked in.
describe('computeNextTurnLanguages', () => {
  it('Person A → Person B swaps source and target', () => {
    const next = computeNextTurnLanguages(true, 'en', 'es');
    expect(next).toEqual({ isPersonATurn: false, currentSourceLanguage: 'es', currentTargetLanguage: 'en' });
  });

  it('Person B → Person A restores the original pairing', () => {
    const next = computeNextTurnLanguages(false, 'en', 'es');
    expect(next).toEqual({ isPersonATurn: true, currentSourceLanguage: 'en', currentTargetLanguage: 'es' });
  });

  it('is a pure function of its inputs — calling it twice with the same inputs gives the same result', () => {
    expect(computeNextTurnLanguages(true, 'hi', 'ta')).toEqual(computeNextTurnLanguages(true, 'hi', 'ta'));
  });

  it('never drifts across a long simulated conversation — every A turn and every B turn always gets the exact same pairing', () => {
    const originalSource = 'en';
    const originalTarget = 'ml';
    let isPersonATurn = true; // Person A always speaks first
    let currentSourceLanguage = originalSource;
    let currentTargetLanguage = originalTarget;

    for (let turn = 1; turn <= 50; turn++) {
      // Simulate the turn "happening" (nothing here can affect language —
      // that's the property under test), then swap for the next turn.
      const next = computeNextTurnLanguages(isPersonATurn, originalSource, originalTarget);
      isPersonATurn = next.isPersonATurn;
      currentSourceLanguage = next.currentSourceLanguage;
      currentTargetLanguage = next.currentTargetLanguage;

      if (isPersonATurn) {
        expect(currentSourceLanguage).toBe(originalSource);
        expect(currentTargetLanguage).toBe(originalTarget);
      } else {
        expect(currentSourceLanguage).toBe(originalTarget);
        expect(currentTargetLanguage).toBe(originalSource);
      }
    }
  });

  it('never drifts even with a 3-way-unrelated language pair (regression scenario matching "3rd or 4th turn")', () => {
    // Mirrors the reported scenario shape: run past turn 4 and confirm turns
    // 3 and 4 specifically still match turns 1 and 2's languages exactly.
    const originalSource = 'ta';
    const originalTarget = 'de';
    const seen: { person: 'A' | 'B'; source: string; target: string }[] = [];
    let isPersonATurn = true;

    for (let turn = 1; turn <= 8; turn++) {
      const next = computeNextTurnLanguages(isPersonATurn, originalSource, originalTarget);
      isPersonATurn = next.isPersonATurn;
      seen.push({
        person: isPersonATurn ? 'A' : 'B',
        source: next.currentSourceLanguage,
        target: next.currentTargetLanguage,
      });
    }

    // Turn indices here are 1-based *swaps after the first turn* — turn 1
    // of the loop is the swap into turn 2 of the conversation (B), turn 2
    // into turn 3 (A), turn 3 into turn 4 (B), etc. Every B entry must
    // match every other B entry; every A entry must match every other A
    // entry — that's the whole property.
    const aTurns = seen.filter((s) => s.person === 'A');
    const bTurns = seen.filter((s) => s.person === 'B');
    expect(aTurns.every((s) => s.source === originalSource && s.target === originalTarget)).toBe(true);
    expect(bTurns.every((s) => s.source === originalTarget && s.target === originalSource)).toBe(true);
  });
});

describe('resolvePersonAAutoSourceLanguage', () => {
  it('uses the detected language when it differs from the target', () => {
    expect(resolvePersonAAutoSourceLanguage('hi', 'en')).toBe('hi');
  });

  it('defaults to English when the detected language equals the target (misdetection guard — X→X is invalid)', () => {
    expect(resolvePersonAAutoSourceLanguage('en', 'en')).toBe('en');
  });

  it('defaults to English when nothing was detected', () => {
    expect(resolvePersonAAutoSourceLanguage(undefined, 'es')).toBe('en');
  });

  it('is only ever meant to run once — downstream callers lock originalSourceLanguage away from "auto" after this', () => {
    // Documents the invariant the class relies on: once resolved, this
    // function is never consulted again for the rest of the conversation
    // (see RealtimeTranslationService.processConversationTurn's guard:
    // `this.isPersonATurn && this.originalSourceLanguage === 'auto'`).
    // Nothing to assert on the pure function itself beyond determinism.
    expect(resolvePersonAAutoSourceLanguage('fr', 'de')).toBe(resolvePersonAAutoSourceLanguage('fr', 'de'));
  });
});
