import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const CACHE_PREFIX = 'tc:';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry {
  translation: string;
  storedAt: number;
}

/**
 * Build a deterministic cache key from source text + language pair.
 * Truncated to 150 chars to keep AsyncStorage keys short.
 */
function makeCacheKey(text: string, source: string, target: string): string {
  const normalised = text.trim().toLowerCase().substring(0, 150);
  return `${CACHE_PREFIX}${source}:${target}:${normalised}`;
}

/**
 * Return a cached translation if one exists and hasn't expired.
 * Returns null on miss, expiry, or any storage error — a cache miss is always
 * recoverable (the caller re-translates), but storage errors are logged rather
 * than dropped so a permanently broken cache is diagnosable.
 */
export async function getCachedTranslation(
  text: string,
  source: string,
  target: string,
): Promise<string | null> {
  try {
    const key = makeCacheKey(text, source, target);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
      // Silently evict expired entry
      AsyncStorage.removeItem(key).catch((err) =>
        logger.warn('Failed to evict expired translation cache entry', { error: errorMessage(err) }));
      return null;
    }

    return entry.translation;
  } catch (err) {
    logger.warn('Translation cache read failed', { error: errorMessage(err) });
    return null;
  }
}

/**
 * Persist a translation result to AsyncStorage (fire-and-forget).
 */
export async function cacheTranslation(
  text: string,
  source: string,
  target: string,
  translation: string,
): Promise<void> {
  try {
    const key = makeCacheKey(text, source, target);
    const entry: CacheEntry = { translation, storedAt: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch (err) {
    // Non-critical (the next call just re-translates), but still worth logging.
    logger.warn('Translation cache write failed', { error: errorMessage(err) });
  }
}
