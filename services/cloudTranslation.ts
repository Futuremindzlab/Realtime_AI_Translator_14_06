import { proxyPost } from '@/lib/apiProxy';
import { HIGH_QUALITY_LANGUAGES } from '@/lib/constants';

// Full language names for translation prompts
const LANG_NAMES: Record<string, string> = {
  en: 'English',    hi: 'Hindi',       ta: 'Tamil',       te: 'Telugu',
  kn: 'Kannada',    ml: 'Malayalam',   mr: 'Marathi',     bn: 'Bengali',
  gu: 'Gujarati',   pa: 'Punjabi',     ur: 'Urdu',        es: 'Spanish',
  fr: 'French',     de: 'German',      it: 'Italian',     pt: 'Portuguese',
  ru: 'Russian',    ja: 'Japanese',    ko: 'Korean',      zh: 'Chinese',
  ar: 'Arabic',     tr: 'Turkish',     th: 'Thai',        vi: 'Vietnamese',
  id: 'Indonesian', nl: 'Dutch',       pl: 'Polish',      uk: 'Ukrainian',
  cs: 'Czech',      fil: 'Filipino',   sv: 'Swedish',     da: 'Danish',
  no: 'Norwegian',  fi: 'Finnish',     el: 'Greek',       hu: 'Hungarian',
  ro: 'Romanian',   sk: 'Slovak',      bg: 'Bulgarian',   sr: 'Serbian',
  he: 'Hebrew',     ca: 'Catalan',     fa: 'Persian',     ms: 'Malay',
  sw: 'Swahili',    hr: 'Croatian',    ne: 'Nepali',      si: 'Sinhala',
};

// Native-script examples embedded in the prompt anchor GPT to the correct Unicode block.
const SCRIPT_EXAMPLES: Record<string, string> = {
  ml: 'ഉദാഹരണം: "നന്ദി" (not "nandi")',
  ta: 'உதாரணம்: "நன்றி" (not "nandri")',
  te: 'ఉదాహరణ: "ధన్యవాదాలు" (not "dhanyavaadaalu")',
  kn: 'ಉದಾಹರಣೆ: "ಧನ್ಯವಾದಗಳು" (not "dhanyavaadagalu")',
  hi: 'उदाहरण: "धन्यवाद" (not "dhanyavaad")',
  mr: 'उदाहरण: "धन्यवाद" (not "dhanyavaad")',
  bn: 'উদাহরণ: "ধন্যবাদ" (not "dhônyôbad")',
  gu: 'ઉદાહરણ: "આભાર" (not "aabhar")',
  pa: 'ਉਦਾਹਰਨ: "ਧੰਨਵਾਦ" (not "dhanyavaad")',
  ur: 'مثال: "شکریہ" (not "shukriya")',
  si: 'නිදසුන: "ස්තූතියි" (not "sthootiyi")',
  ne: 'उदाहरण: "धन्यवाद" (not "dhanyavaad")',
  ar: 'مثال: "شكراً" (not "shukran")',
  fa: 'مثال: "ممنون" (not "mamnoon")',
  he: 'דוגמה: "תודה" (not "toda")',
};

export function langName(code: string): string {
  return LANG_NAMES[code] || code;
}

/** Translate via our backend's /v1/proxy/openai/chat route (keys live server-side). */
async function callProxyChat(
  model: string,
  systemPrompt: string,
  userMessage: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  const response = await proxyPost('/v1/proxy/openai/chat', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.2,
    max_tokens: 1024,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Translation API error ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('Translation API returned an empty result');
  onChunk(text);
  return text;
}

/**
 * Cloud translation shared by the web and native providers: picks the model,
 * builds the native-script prompt, and calls the chat proxy.
 */
export async function cloudTranslate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  // gpt-4o for languages where gpt-4o-mini produces transliteration or wrong-script output
  const model = HIGH_QUALITY_LANGUAGES.has(targetLanguage) ? 'gpt-4o' : 'gpt-4o-mini';
  const srcName = langName(sourceLanguage);
  const tgtName = langName(targetLanguage);
  const scriptHint = SCRIPT_EXAMPLES[targetLanguage] ? ` ${SCRIPT_EXAMPLES[targetLanguage]}.` : '';

  const systemPrompt =
    `You are a professional translator. Translate the user's text from ${srcName} to ${tgtName}. ` +
    `Return ONLY the ${tgtName} translation written entirely in the correct native script — ` +
    `no explanation, no transliteration, no romanization, no Latin characters, no quotation marks.` +
    scriptHint;

  const translation = await callProxyChat(model, systemPrompt, text, onChunk);
  return translation.trim();
}
