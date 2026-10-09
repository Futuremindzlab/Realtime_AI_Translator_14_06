import { isLikelyWhisperHallucination, classifyWhisperHallucination, hasNoSpeechContent } from '@/lib/whisperHallucinations';

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

describe('isLikelyWhisperHallucination — bracketed sound-caption detection (new)', () => {
  // Real production report: "(sizzling)" was transcribed and translated as
  // if it were genuine speech — a sound word never seen before, so it
  // wasn't on the denylist. This covers the whole shape (any short,
  // entirely-bracketed span), not just this one word.
  it('flags the reported case: "(sizzling)"', () => {
    expect(isLikelyWhisperHallucination('(sizzling)')).toBe(true);
    expect(classifyWhisperHallucination('(sizzling)')).toBe('bracketed-caption');
  });

  it('flags other sound words never added to the denylist, as long as they are bracketed', () => {
    expect(isLikelyWhisperHallucination('(dripping)')).toBe(true);
    expect(isLikelyWhisperHallucination('[typing]')).toBe(true);
    expect(isLikelyWhisperHallucination('(papers rustling in the background)')).toBe(true);
  });

  it('does NOT flag a real sentence that merely contains a parenthetical aside', () => {
    expect(isLikelyWhisperHallucination('The meeting is at 5pm (confirmed)')).toBe(false);
  });

  it('does NOT flag an empty bracket pair (handled by hasNoSpeechContent instead)', () => {
    expect(isLikelyWhisperHallucination('()')).toBe(false);
    expect(hasNoSpeechContent('()')).toBe(true);
  });

  it('does not flag a long bracketed span that reads as real spoken content, not a caption', () => {
    expect(isLikelyWhisperHallucination('(I think we should meet again next week to discuss this further)')).toBe(false);
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

describe('classifyWhisperHallucination — names which rule fired (new)', () => {
  // Added after a real transcript (detectedLanguage populated, real length)
  // was still discarded as "No speech detected" with nothing in the log
  // saying which rule caught it or whether one did at all — isLikelyWhisperHallucination's
  // boolean collapses that distinction away.
  it('reports "exact" for a denylisted phrase', () => {
    expect(classifyWhisperHallucination('Thanks for watching')).toBe('exact');
  });

  it('reports "keyword" for a short keyword-built phrase', () => {
    expect(classifyWhisperHallucination('faint engine sound')).toBe('keyword');
  });

  it('reports "repeating-loop" for a stuck-decoder repeat', () => {
    expect(classifyWhisperHallucination(Array(4).fill('thank you').join(' '))).toBe('repeating-loop');
  });

  it('reports null for real, varied speech', () => {
    expect(classifyWhisperHallucination('Can you tell me where the nearest station is?')).toBe(null);
  });

  it('reports null for empty input (handled separately via the length check upstream)', () => {
    expect(classifyWhisperHallucination('')).toBe(null);
  });

  it('agrees with isLikelyWhisperHallucination on every case above', () => {
    const cases = [
      'Thanks for watching',
      'faint engine sound',
      Array(4).fill('thank you').join(' '),
      'Can you tell me where the nearest station is?',
      '',
      'the engine sound was too loud to hear him properly',
    ];
    for (const text of cases) {
      expect(classifyWhisperHallucination(text) !== null).toBe(isLikelyWhisperHallucination(text));
    }
  });
});

describe('hasNoSpeechContent — replaces a length<3 gate that discarded real short replies', () => {
  // Real bug report, reproduced three times: the user spoke clearly in a
  // quiet room and still got "No input — passing to the other person".
  // A length < 3 check used to run before this existed and rejected any
  // transcript under 3 characters regardless of content, discarding every
  // one of these.
  it('does NOT flag short real words as no speech', () => {
    expect(hasNoSpeechContent('Hi')).toBe(false);
    expect(hasNoSpeechContent('No')).toBe(false);
    expect(hasNoSpeechContent('OK')).toBe(false);
    expect(hasNoSpeechContent('I')).toBe(false);
  });

  it('does NOT flag single/double-character CJK words — short but complete replies', () => {
    expect(hasNoSpeechContent('是')).toBe(false); // Chinese "yes"
    expect(hasNoSpeechContent('不')).toBe(false); // Chinese "no"
    expect(hasNoSpeechContent('好')).toBe(false); // Chinese "ok/good"
    expect(hasNoSpeechContent('はい')).toBe(false); // Japanese "yes"
  });

  it('flags empty and whitespace-only input as no speech', () => {
    expect(hasNoSpeechContent('')).toBe(true);
    expect(hasNoSpeechContent('   ')).toBe(true);
  });

  it('flags punctuation-only stray output as no speech', () => {
    expect(hasNoSpeechContent('.')).toBe(true);
    expect(hasNoSpeechContent('...')).toBe(true);
    expect(hasNoSpeechContent('-')).toBe(true);
    expect(hasNoSpeechContent('! ?')).toBe(true);
  });

  it('does not flag ordinary real sentences', () => {
    expect(hasNoSpeechContent('Can you tell me where the nearest station is?')).toBe(false);
  });
});
