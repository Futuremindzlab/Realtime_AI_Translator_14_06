import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheTranslation, getCachedTranslation } from '@/services/translationCache';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe('translationCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockResolvedValue(undefined);
    storage.removeItem.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('cacheTranslation', () => {
    it('stores the translation under a namespaced language-pair key', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000);

      await cacheTranslation('Hello', 'en', 'es', 'Hola');

      const [key, raw] = storage.setItem.mock.calls[0];
      expect(key).toBe('tc:en:es:hello');
      expect(JSON.parse(raw)).toEqual({ translation: 'Hola', storedAt: 1_000 });
    });

    it('normalises whitespace and case, and truncates long text in the key', async () => {
      await cacheTranslation('  HeLLo  ', 'en', 'es', 'Hola');
      expect(storage.setItem.mock.calls[0][0]).toBe('tc:en:es:hello');

      storage.setItem.mockClear();
      await cacheTranslation('a'.repeat(300), 'en', 'es', 'Hola');
      expect(storage.setItem.mock.calls[0][0]).toBe(`tc:en:es:${'a'.repeat(150)}`);
    });

    it('swallows storage write errors', async () => {
      storage.setItem.mockRejectedValue(new Error('quota exceeded'));

      await expect(cacheTranslation('Hello', 'en', 'es', 'Hola')).resolves.toBeUndefined();
    });
  });

  describe('getCachedTranslation', () => {
    it('returns a fresh cached translation for the same text and language pair', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(10_000);
      storage.getItem.mockResolvedValue(JSON.stringify({ translation: 'Hola', storedAt: 9_000 }));

      await expect(getCachedTranslation('Hello', 'en', 'es')).resolves.toBe('Hola');
      expect(storage.getItem).toHaveBeenCalledWith('tc:en:es:hello');
    });

    it('misses when nothing is stored', async () => {
      await expect(getCachedTranslation('Hello', 'en', 'es')).resolves.toBeNull();
    });

    it('evicts and misses on an entry older than the 30-day TTL', async () => {
      const now = THIRTY_DAYS_MS + 5_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      storage.getItem.mockResolvedValue(JSON.stringify({ translation: 'Hola', storedAt: 1_000 }));

      await expect(getCachedTranslation('Hello', 'en', 'es')).resolves.toBeNull();
      expect(storage.removeItem).toHaveBeenCalledWith('tc:en:es:hello');
    });

    it('keeps an entry that is exactly at the TTL boundary', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(THIRTY_DAYS_MS + 1_000);
      storage.getItem.mockResolvedValue(JSON.stringify({ translation: 'Hola', storedAt: 1_000 }));

      await expect(getCachedTranslation('Hello', 'en', 'es')).resolves.toBe('Hola');
      expect(storage.removeItem).not.toHaveBeenCalled();
    });

    it('misses on corrupted JSON instead of throwing', async () => {
      storage.getItem.mockResolvedValue('not json');

      await expect(getCachedTranslation('Hello', 'en', 'es')).resolves.toBeNull();
    });

    it('misses when storage itself fails', async () => {
      storage.getItem.mockRejectedValue(new Error('storage unavailable'));

      await expect(getCachedTranslation('Hello', 'en', 'es')).resolves.toBeNull();
    });

    it('does not share entries across different language pairs', async () => {
      await getCachedTranslation('Hello', 'en', 'fr');

      expect(storage.getItem).toHaveBeenCalledWith('tc:en:fr:hello');
    });
  });
});
