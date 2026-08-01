import {
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  HIGH_QUALITY_LANGUAGES,
  LOW_RESOURCE_LANGUAGES,
  SUPPORTED_LANGUAGES,
  detectScriptLanguage,
  isCorrectScript,
  resolveLanguage,
} from '@/lib/constants';

describe('SUPPORTED_LANGUAGES', () => {
  it('has unique codes and no empty display names', () => {
    const codes = SUPPORTED_LANGUAGES.map(l => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(SUPPORTED_LANGUAGES.every(l => l.name.length > 0 && l.nativeName.length > 0)).toBe(true);
  });

  it('exposes defaults that are themselves supported', () => {
    expect(SUPPORTED_LANGUAGES.some(l => l.code === DEFAULT_SOURCE_LANGUAGE)).toBe(true);
    expect(SUPPORTED_LANGUAGES.some(l => l.code === DEFAULT_TARGET_LANGUAGE)).toBe(true);
  });
});

describe('resolveLanguage', () => {
  it('resolves by ISO code, case-insensitively', () => {
    expect(resolveLanguage('ml')).toEqual({ code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' });
    expect(resolveLanguage('ML').code).toBe('ml');
  });

  it('resolves the full English names Whisper returns', () => {
    expect(resolveLanguage('malayalam').code).toBe('ml');
    expect(resolveLanguage('Japanese').code).toBe('ja');
  });

  it('defaults to English for an empty input', () => {
    expect(resolveLanguage('')).toEqual({ code: 'en', name: 'English', nativeName: 'English' });
  });

  it('echoes back unknown codes instead of throwing', () => {
    expect(resolveLanguage('xx')).toEqual({ code: 'xx', name: 'xx', nativeName: 'xx' });
  });

  it('never resolves a name lookup to the "auto" pseudo-language', () => {
    expect(resolveLanguage('auto detect').code).toBe('auto detect');
    expect(resolveLanguage('auto').code).toBe('auto');
  });
});

describe('isCorrectScript', () => {
  it('accepts text written in the expected non-Latin script', () => {
    expect(isCorrectScript('നന്ദി', 'ml')).toBe(true);
    expect(isCorrectScript('धन्यवाद', 'hi')).toBe(true);
    expect(isCorrectScript('شكراً', 'ar')).toBe(true);
    expect(isCorrectScript('спасибо', 'ru')).toBe(true);
  });

  it('rejects transliterated output for a non-Latin target', () => {
    expect(isCorrectScript('nandi', 'ml')).toBe(false);
    expect(isCorrectScript('dhanyavaad', 'hi')).toBe(false);
  });

  it('skips the check for Latin-script languages', () => {
    expect(isCorrectScript('gracias', 'es')).toBe(true);
    expect(isCorrectScript('anything', 'xx')).toBe(true);
  });
});

describe('detectScriptLanguage', () => {
  it('detects a language from its script', () => {
    expect(detectScriptLanguage('നന്ദി')).toBe('ml');
    expect(detectScriptLanguage('நன்றி')).toBe('ta');
    expect(detectScriptLanguage('ধন্যবাদ')).toBe('bn');
    expect(detectScriptLanguage('감사합니다')).toBe('ko');
  });

  it('returns null for Latin-script or empty text', () => {
    expect(detectScriptLanguage('thank you')).toBeNull();
    expect(detectScriptLanguage('')).toBeNull();
  });

  it('reports one of the Devanagari languages for Devanagari text', () => {
    expect(['hi', 'mr']).toContain(detectScriptLanguage('धन्यवाद'));
  });
});

describe('model-selection language sets', () => {
  it('routes every low-resource language through the high-quality model', () => {
    for (const code of LOW_RESOURCE_LANGUAGES) {
      expect(HIGH_QUALITY_LANGUAGES.has(code)).toBe(true);
    }
  });

  it('covers Indic and RTL scripts but not Latin-script languages', () => {
    expect(HIGH_QUALITY_LANGUAGES.has('ta')).toBe(true);
    expect(HIGH_QUALITY_LANGUAGES.has('he')).toBe(true);
    expect(HIGH_QUALITY_LANGUAGES.has('es')).toBe(false);
    expect(HIGH_QUALITY_LANGUAGES.has('en')).toBe(false);
  });
});
