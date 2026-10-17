import { classifyTurnFailure } from '@/lib/turnFailureHandling';

// Real reports, two rounds:
//
// Round 1: conversation mode's turn 3 failed, Whisper having hallucinated a
// short bracketed caption from a recording glitched by an AppState background
// blip (see audioService.hadAppStateBlipSince). The app treated it identically
// to genuine silence — handing control to the other person with "No input
// from Person X — passing to Person Y" — even though Person X had actually
// spoken. First fix: only real silence (no blip) hands control over; a
// blip-glitched turn retries the same person instead.
//
// Round 2: fresh diagnostics logs showed the AppState blip firing on EVERY
// recording start on some devices — including both turns right before a
// failing one that succeeded cleanly. The flag was never actually predictive
// of a corrupted recording there, so gating the retry on it was either always
// open (useless) or, on a device where it stayed rare, potentially too eager
// to hand over. These tests lock in the corrected behavior: every
// 'No speech detected' failure gets exactly one retry regardless of the blip
// flag (the flag only picks the message), and a second consecutive failure
// hands over.
describe('classifyTurnFailure', () => {
  it('a first "no speech" failure always retries, blip or not', () => {
    expect(classifyTurnFailure('No speech detected', false, false)).toEqual({
      kind: 'retry',
      message: 'No speech detected yet',
    });
    expect(classifyTurnFailure('No speech detected', undefined, false)).toEqual({
      kind: 'retry',
      message: 'No speech detected yet',
    });
    expect(classifyTurnFailure('No speech detected', true, false)).toEqual({
      kind: 'retry',
      message: 'Recording was interrupted',
    });
  });

  it('a second consecutive "no speech" failure hands over, blip or not', () => {
    expect(classifyTurnFailure('No speech detected', false, true)).toEqual({ kind: 'silence-handover' });
    expect(classifyTurnFailure('No speech detected', true, true)).toEqual({ kind: 'silence-handover' });
    expect(classifyTurnFailure('No speech detected', undefined, true)).toEqual({ kind: 'silence-handover' });
  });

  it('any other failure reason retries the same person, blip or not, regardless of prior retry use', () => {
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
