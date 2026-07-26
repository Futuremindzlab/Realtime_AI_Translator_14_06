import { Language } from '@/types';

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'auto', name: 'Auto Detect', nativeName: 'Auto Detect' },
  { code: 'en', name: 'English', nativeName: 'English' },

  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },

  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'zh', name: 'Chinese (Mandarin)', nativeName: '中文' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
];

export const DEFAULT_SOURCE_LANGUAGE = 'auto';
export const DEFAULT_TARGET_LANGUAGE = 'es';

/**
 * Languages where gpt-4o-mini produces transliteration or wrong-script output — use gpt-4o.
 * Includes all Indic scripts and right-to-left scripts, to ensure native-script accuracy.
 * Shared by translationProvider.ts (web) and translationProvider.native.ts (iOS/Android)
 * so translation quality doesn't silently diverge by platform.
 */
export const HIGH_QUALITY_LANGUAGES = new Set([
  // Indic languages (all scripts)
  'ml', 'ta', 'te', 'kn', 'hi', 'mr', 'bn', 'gu', 'pa', 'ur', 'si', 'ne',
  // Right-to-left scripts
  'ar', 'fa', 'he',
]);

// Pre-built lookup maps for fast language resolution
const _byCode = new Map(SUPPORTED_LANGUAGES.map(l => [l.code, l]));
const _byNameLower = new Map(SUPPORTED_LANGUAGES.filter(l => l.code !== 'auto').map(l => [l.name.toLowerCase(), l]));

/**
 * Resolve a language code (e.g. "ml") or Whisper name (e.g. "malayalam")
 * into { code, name, nativeName }.
 */
export function resolveLanguage(codeOrName: string): Language {
  if (!codeOrName) return { code: 'en', name: 'English', nativeName: 'English' };
  const lower = codeOrName.toLowerCase();
  // Try by code first
  const byCode = _byCode.get(lower);
  if (byCode) return byCode;
  // Try by English name (Whisper returns full names like "malayalam")
  const byName = _byNameLower.get(lower);
  if (byName) return byName;
  // Fallback
  return { code: codeOrName, name: codeOrName, nativeName: codeOrName };
}

/**
 * Languages where gpt-4o-mini produces unreliable translations.
 * Malayalam is especially token-heavy (~6-10 tokens/word) and low-resource.
 * Use gpt-4o for these languages for accurate results.
 */
export const LOW_RESOURCE_LANGUAGES = new Set(['ml', 'kn', 'gu', 'pa', 'bn', 'mr', 'ur']);

/**
 * Unicode ranges for non-Latin scripts, used to validate that the
 * translation output actually contains the expected script.
 */
const SCRIPT_UNICODE_RANGES: Record<string, RegExp> = {
  ml: /[\u0D00-\u0D7F]/,   // Malayalam
  hi: /[\u0900-\u097F]/,   // Devanagari (Hindi, Marathi)
  mr: /[\u0900-\u097F]/,   // Devanagari
  ta: /[\u0B80-\u0BFF]/,   // Tamil
  te: /[\u0C00-\u0C7F]/,   // Telugu
  kn: /[\u0C80-\u0CFF]/,   // Kannada
  bn: /[\u0980-\u09FF]/,   // Bengali
  gu: /[\u0A80-\u0AFF]/,   // Gujarati
  pa: /[\u0A00-\u0A7F]/,   // Gurmukhi (Punjabi)
  ur: /[\u0600-\u06FF]/,   // Arabic script (Urdu)
  ar: /[\u0600-\u06FF]/,   // Arabic
  fa: /[\u0600-\u06FF]/,   // Persian
  he: /[\u0590-\u05FF]/,   // Hebrew
  th: /[\u0E00-\u0E7F]/,   // Thai
  ja: /[\u3040-\u30FF\u4E00-\u9FFF]/, // Japanese (Hiragana, Katakana, CJK)
  ko: /[\uAC00-\uD7AF\u1100-\u11FF]/, // Korean (Hangul)
  zh: /[\u4E00-\u9FFF]/,   // Chinese (CJK)
  ru: /[\u0400-\u04FF]/,   // Cyrillic
  uk: /[\u0400-\u04FF]/,   // Cyrillic
  bg: /[\u0400-\u04FF]/,   // Cyrillic
  sr: /[\u0400-\u04FF]/,   // Cyrillic
  el: /[\u0370-\u03FF]/,   // Greek
};

/**
 * Check if the translated text contains the expected script for the target language.
 * Returns true if no script check is needed (Latin-script languages) or if the
 * expected script characters are found.
 */
export function isCorrectScript(text: string, langCode: string): boolean {
  const pattern = SCRIPT_UNICODE_RANGES[langCode];
  if (!pattern) return true; // Latin-script languages — no check needed
  return pattern.test(text);
}

/**
 * Best-effort script-based language detection. Used to cross-check Whisper's
 * declared `language` field, which is unreliable for closely related Indic
 * scripts (e.g. it frequently reports "tamil" for Malayalam audio even though
 * the transcribed text itself is in the correct Malayalam Unicode range).
 * Returns null if the text doesn't match any known non-Latin script.
 */
export function detectScriptLanguage(text: string): string | null {
  for (const [code, pattern] of Object.entries(SCRIPT_UNICODE_RANGES)) {
    if (pattern.test(text)) return code;
  }
  return null;
}
