import AsyncStorage from '@react-native-async-storage/async-storage';

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
 * Returns null on miss, expiry, or any storage error.
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
      AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }

    return entry.translation;
  } catch {
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
  } catch {
    // Non-critical — ignore write errors
  }
}
