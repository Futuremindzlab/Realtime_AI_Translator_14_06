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
    expect(classifyTurnFailure('No speech detected', false, false)).toEqual({ kind: 'silence-handover' });
    expect(classifyTurnFailure('No speech detected', undefined, false)).toEqual({ kind: 'silence-handover' });
  });

  it('a blip-glitched "no speech" result retries the same person with an honest message, on the first failure', () => {
    expect(classifyTurnFailure('No speech detected', true, false)).toEqual({
      kind: 'retry',
      message: 'Recording was interrupted',
    });
  });

  // Real follow-up report: on some Android devices the AppState blip fires on
  // EVERY recording start, success or not — two healthy turns can show the
  // same blip as a failing third one. There, the flag can't distinguish a
  // genuine glitch from normal device noise, and always trusting it turned
  // repeated genuine silence into a retry loop that exhausted the retry
  // budget and forced a restart. This caps the benefit of the doubt at one
  // retry: a second consecutive blip-flagged "no speech" failure for the
  // same person's turn hands over instead of retrying again.
  it('a second consecutive blip-flagged "no speech" failure for the same turn hands over instead of retrying again', () => {
    expect(classifyTurnFailure('No speech detected', true, true)).toEqual({ kind: 'silence-handover' });
  });

  it('any other failure reason retries the same person, blip or not, regardless of prior blip-retry use', () => {
    expect(classifyTurnFailure('Translation failed', false, false)).toEqual({
      kind: 'retry',
      message: 'Translation failed',
    });
    expect(classifyTurnFailure('Translation failed', true, false)).toEqual({
      kind: 'retry',
      message: 'Recording was interrupted',
    });
    expect(classifyTurnFailure('Translation failed', true, true)).toEqual({
      kind: 'retry',
      message: 'Recording was interrupted',
    });
  });

  it('falls back to a generic message when no reason is given', () => {
    expect(classifyTurnFailure(undefined, false, false)).toEqual({ kind: 'retry', message: 'Turn failed' });
  });
});
