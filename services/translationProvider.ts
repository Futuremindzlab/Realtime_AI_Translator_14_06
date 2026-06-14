import EventSource from 'react-native-sse';

export type TranslationProviderName = 'openai' | 'device';

// Full language names for translation prompts — clearer than ISO codes for the model
const LANG_NAMES: Record<string, string> = {
  en: 'English',  hi: 'Hindi',    ta: 'Tamil',     te: 'Telugu',
  kn: 'Kannada',  ml: 'Malayalam', mr: 'Marathi',   bn: 'Bengali',
  gu: 'Gujarati', pa: 'Punjabi',   ur: 'Urdu',      es: 'Spanish',
  fr: 'French',   de: 'German',    it: 'Italian',   pt: 'Portuguese',
  ru: 'Russian',  ja: 'Japanese',  ko: 'Korean',    zh: 'Chinese',
  ar: 'Arabic',   tr: 'Turkish',   th: 'Thai',      vi: 'Vietnamese',
  id: 'Indonesian', nl: 'Dutch',   pl: 'Polish',    uk: 'Ukrainian',
  cs: 'Czech',    fil: 'Filipino', sv: 'Swedish',   da: 'Danish',
  no: 'Norwegian', fi: 'Finnish',  el: 'Greek',     hu: 'Hungarian',
  ro: 'Romanian', sk: 'Slovak',    bg: 'Bulgarian', sr: 'Serbian',
  he: 'Hebrew',   ca: 'Catalan',   fa: 'Persian',   ms: 'Malay',
  sw: 'Swahili',  ne: 'Nepali',    si: 'Sinhala',
};

function langName(code: string): string {
  return LANG_NAMES[code] || code;
}

class TranslationProvider {
  private provider: TranslationProviderName = 'openai';
  // Cache for device translators / models
  private deviceCache: Record<string, any> = {};

  setProvider(name: TranslationProviderName) {
    this.provider = name;
  }

  getProvider(): TranslationProviderName {
    return this.provider;
  }

  isDeviceReady(): boolean {
    // Return true if any device model has been preloaded, or allow caller to check specific model via cache
    return Object.keys(this.deviceCache).length > 0;
  }

  async initializeDeviceModel(modelId: string): Promise<boolean> {
    try {
      // Lazy-import transformers and preload pipeline/model
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const transformers: any = await import('@xenova/transformers');

      if (transformers.pipeline) {
        this.deviceCache[modelId] = await transformers.pipeline('translation', modelId);
        console.log(`[translationProvider] Preloaded device model pipeline: ${modelId}`);
        return true;
      }

      // Fallback low-level load
      const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelId);
      const model = await transformers.AutoModelForSeq2SeqLM.from_pretrained(modelId);
      this.deviceCache[modelId] = { tokenizer, model };
      console.log(`[translationProvider] Preloaded device model (tokenizer+model): ${modelId}`);
      return true;
    } catch (err) {
      console.warn('[translationProvider] initializeDeviceModel failed:', err);
      return false;
    }
  }

  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    if (this.provider === 'device') {
      return await this.deviceTranslate(text, sourceLanguage, targetLanguage, onChunk);
    }

    const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

    const model = 'gpt-4o-mini';
    const srcName = langName(sourceLanguage);
    const tgtName = langName(targetLanguage);
    const systemPrompt =
      `You are a professional translator. Translate the user's text from ${srcName} to ${tgtName}. ` +
      `Return ONLY the translated text — no explanation, no preamble, no quotation marks.`;

    try {
      const translation = await this.streamTranslation(OPENAI_API_KEY, model, systemPrompt, text, onChunk);
      return translation.trim();
    } catch (streamErr) {
      // SSE can fail on some Android/network environments — plain fetch is the reliable fallback
      console.warn('[translationProvider] SSE stream failed, using plain fetch:', streamErr);
      return this.fetchTranslation(OPENAI_API_KEY, model, systemPrompt, text, onChunk);
    }
  }

  // Non-streaming fallback used when SSE fails (e.g. network issues on Android)
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
        temperature: 0.3,
        max_tokens: 512,
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
          temperature: 0.3,
          max_tokens: 512,
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
          // ignore
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

  private async deviceTranslate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    // Basic device implementation using transformers.js (@xenova/transformers)
    // This is a best-effort integration: devices must bundle or download models.
    // If the library or model isn't available, throw a descriptive error.
    const modelIdCandidates = [
      `Helsinki-NLP/opus-mt-${sourceLanguage}-${targetLanguage}`,
      `Helsinki-NLP/opus-mt-${sourceLanguage}-en`,
      `Helsinki-NLP/opus-mt-en-${targetLanguage}`,
    ];

    try {
      // Lazy-import to avoid loading heavy libs on platforms that don't support them
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const transformers: any = await import('@xenova/transformers');

      // Try model candidates and cache pipelines
      for (const modelId of modelIdCandidates) {
        try {
          if (!this.deviceCache[modelId]) {
            if (transformers.pipeline) {
              // pipeline returns a callable pipeline object — store it directly
              this.deviceCache[modelId] = await transformers.pipeline('translation', modelId);
            } else {
              // Fallback low-level load
              const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelId);
              const model = await transformers.AutoModelForSeq2SeqLM.from_pretrained(modelId);
              this.deviceCache[modelId] = { tokenizer, model };
            }
          }

          const cached = this.deviceCache[modelId];

          // The pipeline object IS callable — invoke it directly (not as .pipeline())
          if (cached && typeof cached === 'function') {
            const res = await cached(text);
            const translated = Array.isArray(res)
              ? (res[0]?.translation_text || res[0]?.generated_text || '')
              : (res?.translation_text || res?.generated_text || String(res));
            if (translated.trim()) { onChunk(translated); return translated; }
          }

          // Pipeline object may also be callable as an object (some versions)
          if (cached && cached.tokenizer && cached.model) {
            const tokenizer = cached.tokenizer;
            const model = cached.model;
            const inputs = await tokenizer(text);
            const outputs = await model.generate(inputs.input_ids);
            const decoded = await tokenizer.decode(outputs[0], { skip_special_tokens: true });
            onChunk(decoded);
            return decoded;
          }

        } catch (err) {
          // Try next candidate
          console.warn(`[translationProvider] model ${modelId} load/exec failed:`, (err as any)?.message || err);
          continue;
        }
      }

      throw new Error('No suitable on-device translation model found. Please bundle a Helsinki-NLP opus-mt model or use the cloud provider.');
    } catch (err: any) {
      // Import or runtime failure
      throw new Error(`Device translation unavailable: ${err?.message || err}`);
    }
  }
}

export const translationProvider = new TranslationProvider();

/*
Integration notes:
- To enable on-device translation, implement the `device` branch in `translate()`.
- Possible options:
  - Use `@xenova/transformers` (transformers.js) with a small Marian/OPUS-MT model bundled for the target languages.
  - Use `onnxruntime-react-native` or a native module that runs an exported translation model.
  - Expose a native bridge that calls a local server (e.g., a bundled tiny translation engine) when offline.
- Device implementations should support incremental streaming where possible (call `onChunk`).
*/
