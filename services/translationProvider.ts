import { cloudTranslate } from '@/services/cloudTranslation';

export type TranslationProviderName = 'openai' | 'device';

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

    return cloudTranslate(text, sourceLanguage, targetLanguage, onChunk);
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
