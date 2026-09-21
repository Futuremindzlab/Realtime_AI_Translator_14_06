import { isLikelyWhisperHallucination } from '@/lib/whisperHallucinations';

describe('isLikelyWhisperHallucination — non-speech caption denylist (existing behavior)', () => {
  it('flags known caption-style hallucinations', () => {
    expect(isLikelyWhisperHallucination('Engine sound')).toBe(true);
    expect(isLikelyWhisperHallucination('[Music]')).toBe(true);
    expect(isLikelyWhisperHallucination('Thanks for watching')).toBe(true);
  });

  it('flags a short phrase built around a hallucination keyword', () => {
    expect(isLikelyWhisperHallucination('faint engine sound')).toBe(true);
  });

  it('does NOT flag a real sentence that happens to mention the same keyword', () => {
    expect(isLikelyWhisperHallucination('the engine sound was too loud to hear him properly')).toBe(false);
  });

  it('does not flag real speech', () => {
    expect(isLikelyWhisperHallucination('Can you tell me where the nearest station is?')).toBe(false);
  });

  it('does not flag empty or whitespace-only input', () => {
    expect(isLikelyWhisperHallucination('')).toBe(false);
    expect(isLikelyWhisperHallucination('   ')).toBe(false);
  });
});

describe('isLikelyWhisperHallucination — repetition-loop detection (new)', () => {
  it('flags a single word repeating many times in a row', () => {
    // The exact production case: Malayalam STT stuck on a single word
    // meaning "that day", and its faithfully-translated English side.
    // Built via Array(n).fill(word).join(' ') rather than hand-typed N
    // times in a row — several near-identical Indic vowel signs across
    // scripts (e.g. Malayalam U+0D41 vs Tamil U+0BC1) are visually
    // indistinguishable but different code points, and a single mistyped
    // occurrence silently breaks the "all repeats are byte-identical"
    // premise this test depends on.
    const malayalamWord = String.fromCodePoint(0x0d05, 0x0d28, 0x0d4d, 0x0d28, 0x0d41); // അന്നു
    expect(isLikelyWhisperHallucination(Array(6).fill(malayalamWord).join(' '))).toBe(true);
    expect(isLikelyWhisperHallucination(Array(5).fill('that day').join(' '))).toBe(true);
  });

  it('flags a two-word phrase repeating many times in a row', () => {
    expect(isLikelyWhisperHallucination(Array(4).fill('thank you').join(' '))).toBe(true);
  });

  it('flags a three-word phrase repeating', () => {
    expect(isLikelyWhisperHallucination(Array(3).fill('see you later').join(' '))).toBe(true);
  });

  it('does NOT flag a word repeated only 2-3 times — plausible real emphasis', () => {
    expect(isLikelyWhisperHallucination('no no I really do not want that')).toBe(false);
    expect(isLikelyWhisperHallucination('please please help me')).toBe(false);
  });

  it('does not flag ordinary varied speech of similar length', () => {
    expect(isLikelyWhisperHallucination('I went to the market yesterday and bought some vegetables')).toBe(false);
  });

  it('does not flag short input below the loop-detection window', () => {
    expect(isLikelyWhisperHallucination('day day')).toBe(false);
  });
});
