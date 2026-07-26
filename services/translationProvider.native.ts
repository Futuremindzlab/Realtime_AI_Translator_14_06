import { proxyPost } from '@/lib/apiProxy';
import { HIGH_QUALITY_LANGUAGES } from '@/lib/constants';

// Native (iOS/Android) version — @xenova/transformers is web-only (WASM + import.meta).
// Metro automatically picks this file over translationProvider.ts on native platforms.

export type TranslationProviderName = 'openai' | 'device';

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

function langName(code: string): string {
  return LANG_NAMES[code] || code;
}

class TranslationProvider {
  private provider: TranslationProviderName = 'openai';

  setProvider(name: TranslationProviderName) {
    this.provider = name;
  }

  getProvider(): TranslationProviderName {
    return this.provider;
  }

  isDeviceReady(): boolean {
    return false;
  }

  async initializeDeviceModel(_modelId: string): Promise<boolean> {
    return false;
  }

  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    // gpt-4o for languages where gpt-4o-mini has poor script/vocabulary coverage
    const model = HIGH_QUALITY_LANGUAGES.has(targetLanguage) ? 'gpt-4o' : 'gpt-4o-mini';
    const srcName = langName(sourceLanguage);
    const tgtName = langName(targetLanguage);
    // Explicit instruction to use native script prevents Latin transliteration
    const systemPrompt =
      `You are a professional translator. Translate the user's text from ${srcName} to ${tgtName}. ` +
      `Return ONLY the ${tgtName} translation written in the correct native script — ` +
      `no explanation, no transliteration, no romanization, no quotation marks.`;

    return this.callProxyChat(model, systemPrompt, text, onChunk);
  }

  /** Translate via our backend's /v1/proxy/openai/chat route (keys live server-side). */
  private async callProxyChat(
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
}

export const translationProvider = new TranslationProvider();
