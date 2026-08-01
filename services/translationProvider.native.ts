import { cloudTranslate } from '@/services/cloudTranslation';

// Native (iOS/Android) version — @xenova/transformers is web-only (WASM + import.meta).
// Metro automatically picks this file over translationProvider.ts on native platforms.

export type TranslationProviderName = 'openai' | 'device';

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
    return cloudTranslate(text, sourceLanguage, targetLanguage, onChunk);
  }
}

export const translationProvider = new TranslationProvider();
