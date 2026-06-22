import EventSource from 'react-native-sse';

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

// Languages where gpt-4o-mini produces poor quality — use gpt-4o for these
const HIGH_QUALITY_LANGUAGES = new Set([
  'ml', 'kn', 'gu', 'pa', 'bn', 'mr', 'ur', 'si', 'ne',
]);

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
    const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

    // gpt-4o for languages where gpt-4o-mini has poor script/vocabulary coverage
    const model = HIGH_QUALITY_LANGUAGES.has(targetLanguage) ? 'gpt-4o' : 'gpt-4o-mini';
    const srcName = langName(sourceLanguage);
    const tgtName = langName(targetLanguage);
    // Explicit instruction to use native script prevents Latin transliteration
    const systemPrompt =
      `You are a professional translator. Translate the user's text from ${srcName} to ${tgtName}. ` +
      `Return ONLY the ${tgtName} translation written in the correct native script — ` +
      `no explanation, no transliteration, no romanization, no quotation marks.`;

    try {
      return await this.streamTranslation(OPENAI_API_KEY, model, systemPrompt, text, onChunk);
    } catch (streamErr) {
      console.warn('[translationProvider] SSE stream failed, using plain fetch:', streamErr);
      return this.fetchTranslation(OPENAI_API_KEY, model, systemPrompt, text, onChunk);
    }
  }

  private async fetchTranslation(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userMessage: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`OpenAI API error ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('OpenAI returned an empty translation');
    onChunk(text);
    return text;
  }

  private streamTranslation(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userMessage: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let fullText = '';
      const timeoutMs = 15000;
      let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        es.close();
        if (fullText) resolve(fullText.trim());
        else reject(new Error('Translation timed out'));
      }, timeoutMs);

      const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

      const es = new EventSource('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2,
          max_tokens: 1024,
        }),
      });

      es.addEventListener('message', (event: any) => {
        if (!event.data || event.data === '[DONE]') {
          clearTimer();
          es.close();
          resolve(fullText.trim());
          return;
        }
        try {
          const parsed = JSON.parse(event.data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
        } catch {
          // ignore malformed SSE chunk
        }
      });

      es.addEventListener('error', (event: any) => {
        clearTimer();
        es.close();
        if (fullText.trim()) resolve(fullText.trim());
        else reject(new Error(event?.message || 'Streaming translation failed'));
      });
    });
  }
}

export const translationProvider = new TranslationProvider();
