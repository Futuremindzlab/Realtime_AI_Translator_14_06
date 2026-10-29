import { detectScriptLanguage, isCorrectScript } from '@/lib/constants';

// Regression for: conversation mode locking Person A's auto-detected source
// language to "hi" when Whisper mislabeled English audio, because the
// mislabel-correction path only ever corrected between two *non-Latin*
// scripts and gave up (returning null, i.e. "trust the mislabel") whenever
// the actual transcript was plain Latin text.
describe('detectScriptLanguage', () => {
  it('detects Tamil script', () => {
    expect(detectScriptLanguage('வணக்கம்')).toBe('ta');
  });

  it('detects Devanagari script', () => {
    expect(detectScriptLanguage('नमस्ते')).toBe('hi');
  });

  it('reports English for plain Latin text that matches no non-Latin script', () => {
    expect(detectScriptLanguage('Hello, how are you?')).toBe('en');
  });

  it('returns null for text with no letters at all', () => {
    expect(detectScriptLanguage('123 !?')).toBeNull();
  });
});

describe('isCorrectScript + detectScriptLanguage correction (RealtimeTranslationService.resolveDetectedLanguage logic)', () => {
  it('corrects a Hindi mislabel on actually-English (Latin-script) text', () => {
    const text = 'Hello, how are you doing today?';
    const declared = 'hi';
    expect(isCorrectScript(text, declared)).toBe(false);
    expect(detectScriptLanguage(text)).toBe('en');
  });

  it('leaves a correct Hindi label alone when the text is genuinely Devanagari', () => {
    const text = 'नमस्ते, आप कैसे हैं?';
    const declared = 'hi';
    expect(isCorrectScript(text, declared)).toBe(true);
  });

  it('still corrects between two non-Latin scripts (pre-existing behavior)', () => {
    const text = 'வணக்கம்'; // Tamil text
    const declared = 'ml'; // mislabeled as Malayalam
    expect(isCorrectScript(text, declared)).toBe(false);
    expect(detectScriptLanguage(text)).toBe('ta');
  });
});
