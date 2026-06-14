import { audioService } from './audioService';
import { whisperService } from './whisperService';
import { ttsService, TTSProvider } from './ttsService';
import { getCachedTranslation, cacheTranslation } from './translationCache';
import { Platform } from 'react-native';
import { dynamoService } from './dynamoService';
import { resolveLanguage, LOW_RESOURCE_LANGUAGES, isCorrectScript } from '@/lib/constants';
import EventSource from 'react-native-sse';

export interface TranslationProgress {
  stage: 'recording' | 'transcribing' | 'translating' | 'generating_speech' | 'playing' | 'complete' | 'error';
  sourceText?: string;
  translatedText?: string;
  error?: string;
}

export class TranslationService {
  private onProgressCallback: ((progress: TranslationProgress) => void) | null = null;
  private stopCommandDetected = false;

  setProgressCallback(callback: (progress: TranslationProgress) => void) {
    this.onProgressCallback = callback;
  }

  private updateProgress(progress: TranslationProgress) {
    if (this.onProgressCallback) {
      this.onProgressCallback(progress);
    }
  }

  private detectStopCommand(text: string): boolean {
    const lowerText = text.toLowerCase().trim();
    const stopKeywords = ['stop', 'end', 'over', 'stop recording', 'end recording'];

    for (const keyword of stopKeywords) {
      if (lowerText.endsWith(keyword) || lowerText === keyword ||
          lowerText.includes(` ${keyword} `) || lowerText.startsWith(`${keyword} `)) {
        console.log(`Stop command detected: "${keyword}" in "${text}"`);
        return true;
      }
    }
    return false;
  }

  resetStopCommand() {
    this.stopCommandDetected = false;
  }

  isStopCommandDetected(): boolean {
    return this.stopCommandDetected;
  }

  private async translateDirect(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    // Check translation cache first (AsyncStorage, 30-day TTL)
    const cached = await getCachedTranslation(text, sourceLanguage, targetLanguage);
    if (cached) {
      console.log('⚡ [TranslationCache] Cache hit — skipping GPT call');
      onChunk(cached);
      return cached;
    }

    const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const target = resolveLanguage(targetLanguage);
    const source = resolveLanguage(sourceLanguage);
    const targetLabel = target.name !== target.nativeName
      ? `${target.name} (${target.nativeName})`
      : target.name;

    const systemPrompt = `You are a professional ${source.name} to ${targetLabel} translator. When the user gives you text in ${source.name}, you translate it into ${targetLabel} and respond with ONLY the translation in ${target.nativeName} script. No explanations, no transliterations, no romanization, no original text repeated.`;

    const userPrompt = `Translate to ${targetLabel}: ${text}`;

    const model = LOW_RESOURCE_LANGUAGES.has(target.code) ? 'gpt-4o' : 'gpt-4o-mini';

    let translation = await this.streamTranslation(OPENAI_API_KEY, model, systemPrompt, userPrompt, onChunk);

    // Script validation + retry only for low-resource languages
    if (LOW_RESOURCE_LANGUAGES.has(target.code) && translation && !isCorrectScript(translation, target.code)) {
      console.warn(`⚠️ Script validation failed for ${target.name}. Retrying...`);
      const retryPrompt = `Translate the following text into ${targetLabel}. Write ONLY in ${target.nativeName} script:\n\n${text}`;
      translation = await this.callTranslationAPI(OPENAI_API_KEY, 'gpt-4o', systemPrompt, retryPrompt);
      onChunk(translation);
    }

    const result = translation.trim();

    // Persist to cache for future calls (fire-and-forget)
    cacheTranslation(text, sourceLanguage, targetLanguage, result).catch(() => {});

    return result;
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
      let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        es.close();
        fullText ? resolve(fullText.trim()) : reject(new Error('Translation timed out'));
      }, 15000);

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
          max_tokens: 256,
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
          // Ignore malformed chunks
        }
      });

      es.addEventListener('error', (event: any) => {
        clearTimer();
        es.close();
        fullText.trim() ? resolve(fullText.trim()) : reject(new Error(event?.message || 'Streaming translation failed'));
      });
    });
  }

  /** Non-streaming fallback for script-validation retries */
  private async callTranslationAPI(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userMessage: string
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
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Translation failed: ${errorData?.error?.message || response.status}`);
    }

    const data = await response.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  async startRecording(): Promise<void> {
    try {
      this.updateProgress({ stage: 'recording' });
      await audioService.startRecording();
    } catch (error) {
      console.error('Error starting recording:', error);
      this.updateProgress({
        stage: 'error',
        error: error instanceof Error ? error.message : 'Failed to start recording',
      });
      throw error;
    }
  }

  async stopRecordingAndTranslate(
    sourceLanguage: string,
    targetLanguage: string,
    ttsProvider: TTSProvider = 'openai',
    userId?: string
  ): Promise<void> {
    try {
      const audioUri = await audioService.stopRecording();
      if (!audioUri) {
        throw new Error('No audio recorded');
      }

      this.updateProgress({ stage: 'transcribing' });
      const { text: sourceText, detectedLanguage } = await whisperService.transcribeWithFallback(
        audioUri,
        sourceLanguage
      );

      this.updateProgress({ stage: 'transcribing', sourceText });

      if (this.detectStopCommand(sourceText)) {
        this.stopCommandDetected = true;
        console.log('Stop command detected - ending translation');
        this.updateProgress({ stage: 'complete', sourceText, translatedText: 'Recording stopped by voice command' });
        return;
      }

      this.updateProgress({ stage: 'translating', sourceText });
      let translatedText = '';

      const effectiveSourceLang = detectedLanguage || sourceLanguage;
      await this.translateDirect(
        sourceText,
        effectiveSourceLang,
        targetLanguage,
        (chunk) => {
          translatedText += chunk;
          this.updateProgress({
            stage: 'translating',
            sourceText,
            translatedText,
          });
        }
      );

      this.updateProgress({ stage: 'generating_speech', sourceText, translatedText });
      const translatedAudioUri = await ttsService.generateSpeech(
        translatedText,
        targetLanguage,
        ttsProvider
      );

      this.updateProgress({ stage: 'playing', sourceText, translatedText });
      if (translatedAudioUri) {
        await audioService.playAudio(translatedAudioUri);
      }

      if (userId) {
        await this.saveToHistory(
          userId,
          sourceLanguage,
          targetLanguage,
          sourceText,
          translatedText,
        );
      }

      this.updateProgress({ stage: 'complete', sourceText, translatedText });
    } catch (error) {
      console.error('Error in translation process:', error);
      this.updateProgress({
        stage: 'error',
        error: error instanceof Error ? error.message : 'Translation failed',
      });
      throw error;
    }
  }

  async translateFromAudioUri(
    audioUri: string,
    sourceLanguage: string,
    targetLanguage: string,
    ttsProvider: TTSProvider = 'openai',
    userId?: string
  ): Promise<void> {
    try {
      this.updateProgress({ stage: 'transcribing' });
      const { text: sourceText, detectedLanguage } = await whisperService.transcribeWithFallback(
        audioUri,
        sourceLanguage
      );

      this.updateProgress({ stage: 'transcribing', sourceText });

      if (this.detectStopCommand(sourceText)) {
        this.stopCommandDetected = true;
        console.log('Stop command detected - ending translation');
        this.updateProgress({ stage: 'complete', sourceText, translatedText: 'Recording stopped by voice command' });
        return;
      }

      this.updateProgress({ stage: 'translating', sourceText });
      let translatedText = '';

      const effectiveSourceLang = detectedLanguage || sourceLanguage;
      await this.translateDirect(
        sourceText,
        effectiveSourceLang,
        targetLanguage,
        (chunk) => {
          translatedText += chunk;
          this.updateProgress({
            stage: 'translating',
            sourceText,
            translatedText,
          });
        }
      );

      this.updateProgress({ stage: 'generating_speech', sourceText, translatedText });
      const translatedAudioUri = await ttsService.generateSpeech(
        translatedText,
        targetLanguage,
        ttsProvider
      );

      this.updateProgress({ stage: 'playing', sourceText, translatedText });
      if (translatedAudioUri) {
        await audioService.playAudio(translatedAudioUri);
      }

      if (userId) {
        await this.saveToHistory(
          userId,
          sourceLanguage,
          targetLanguage,
          sourceText,
          translatedText,
        );
      }

      this.updateProgress({ stage: 'complete', sourceText, translatedText });
    } catch (error) {
      console.error('Error in translation process:', error);
      this.updateProgress({
        stage: 'error',
        error: error instanceof Error ? error.message : 'Translation failed',
      });
      throw error;
    }
  }

  private async saveToHistory(
    userId: string,
    sourceLanguage: string,
    targetLanguage: string,
    sourceText: string,
    translatedText: string,
  ): Promise<void> {
    try {
      if (!dynamoService.isInitialized()) {
        console.log('ℹ️ DynamoDB not available — skipping history save');
        return;
      }

      await dynamoService.putConversationHistory({
        user_id: userId,
        timestamp: new Date().toISOString(),
        source_language: sourceLanguage,
        target_language: targetLanguage,
        source_text: sourceText,
        translated_text: translatedText,
        conversation_mode: false,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error in saveToHistory:', error);
    }
  }

  async cleanup(): Promise<void> {
    await audioService.cleanup();
  }
}

export const translationService = new TranslationService();
