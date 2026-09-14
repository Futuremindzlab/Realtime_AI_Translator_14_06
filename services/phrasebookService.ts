import AsyncStorage from '@react-native-async-storage/async-storage';
import { translationProvider } from './translationProvider';
import { getCachedTranslation, cacheTranslation } from './translationCache';

const STORAGE_KEY = 'onelingo_phrasebook_v1';

export type PhraseCategory = 'general' | 'travel' | 'meeting' | 'urgent';

export interface Phrase {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  category: PhraseCategory;
  createdAt: number;
}

/**
 * Local-only phrasebook — Design C's "speak instantly, no mic needed" screen.
 * Deliberately AsyncStorage rather than a backend table for this first pass:
 * it's per-device (doesn't sync across a user's devices yet), but ships with
 * no new backend/DynamoDB work. Promoting it to a synced dynamoService table
 * is a natural follow-up if it proves useful.
 */
class PhrasebookService {
  private cache: Phrase[] | null = null;

  async getAll(): Promise<Phrase[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      this.cache = raw ? JSON.parse(raw) : [];
    } catch {
      this.cache = [];
    }
    return this.cache!;
  }

  private async persist(phrases: Phrase[]): Promise<void> {
    this.cache = phrases;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(phrases));
  }

  /** Translates the phrase (cached, same pipeline as live translation) and saves it. */
  async add(
    sourceText: string,
    sourceLang: string,
    targetLang: string,
    category: PhraseCategory = 'general',
  ): Promise<Phrase> {
    const text = sourceText.trim();
    if (!text) throw new Error('Phrase text is empty');

    let translatedText = await getCachedTranslation(text, sourceLang, targetLang);
    if (!translatedText) {
      translatedText = await translationProvider.translate(text, sourceLang, targetLang, () => {});
      cacheTranslation(text, sourceLang, targetLang, translatedText).catch(() => {});
    }

    const phrase: Phrase = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceText: text,
      translatedText,
      sourceLang,
      targetLang,
      category,
      createdAt: Date.now(),
    };

    const current = await this.getAll();
    await this.persist([phrase, ...current]);
    return phrase;
  }

  async remove(id: string): Promise<void> {
    const current = await this.getAll();
    await this.persist(current.filter(p => p.id !== id));
  }
}

export const phrasebookService = new PhrasebookService();
