import { classifyTurnFailure } from '@/lib/turnFailureHandling';

// Real report: conversation mode's turn 3 failed, Whisper having hallucinated
// a short bracketed caption from a recording glitched by an AppState
// background blip (see audioService.hadAppStateBlipSince). The app treated it
// identically to genuine silence — handing control to the other person with
// "No input from Person X — passing to Person Y" — even though Person X had
// actually spoken. These tests lock in the fix: only real silence (no blip)
// hands control over; a blip-glitched turn retries the same person instead,
// with a message that doesn't claim the person said nothing.
describe('classifyTurnFailure', () => {
  it('genuine silence (no blip) hands control to the other person', () => {
    expect(classifyTurnFailure('No speech detected', false)).toEqual({ kind: 'silence-handover' });
    expect(classifyTurnFailure('No speech detected', undefined)).toEqual({ kind: 'silence-handover' });
  });

  it('a blip-glitched "no speech" result retries the same person with an honest message', () => {
    expect(classifyTurnFailure('No speech detected', true)).toEqual({
      kind: 'retry',
      message: 'Recording was interrupted',
    });
  });

  it('any other failure reason retries the same person, blip or not', () => {
    expect(classifyTurnFailure('Translation failed', false)).toEqual({
      kind: 'retry',
      message: 'Translation failed',
    });
    expect(classifyTurnFailure('Translation failed', true)).toEqual({
      kind: 'retry',
      message: 'Recording was interrupted',
    });
  });

  it('falls back to a generic message when no reason is given', () => {
    expect(classifyTurnFailure(undefined, false)).toEqual({ kind: 'retry', message: 'Turn failed' });
  });
});
