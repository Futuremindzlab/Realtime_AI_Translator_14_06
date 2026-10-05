/**
 * AWS client setup — Cognito only.
 *
 * DynamoDB is now accessed via API Gateway + Lambda (see backend/).
 * The DynamoDB SDK and Identity Pool credentials are no longer needed here.
 */
import { CognitoUserPool, ICognitoStorage } from 'amazon-cognito-identity-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { logger } from '@/lib/logger';

const AWS_REGION          = process.env.EXPO_PUBLIC_AWS_REGION               || '';
const USER_POOL_ID        = process.env.EXPO_PUBLIC_AWS_USER_POOL_ID         || '';
const USER_POOL_CLIENT_ID = process.env.EXPO_PUBLIC_AWS_USER_POOL_CLIENT_ID  || '';

// These are live Cognito session tokens (id/access/refresh) — AsyncStorage is
// unencrypted on-disk storage any other app code (or, on a rooted/jailbroken
// device, anyone with filesystem access) can read. On native we use
// SecureStore instead (Keychain on iOS, Keystore-backed
// EncryptedSharedPreferences on Android). SecureStore has no native
// equivalent on web, so web keeps using AsyncStorage (backed by
// localStorage) exactly as before — same trust model web already has for
// everything else there, and no behavior change for web sessions.
const isNative = Platform.OS !== 'web';
const nativePersist = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
const webPersist = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};
const persist = isNative ? nativePersist : webPersist;

// Bridge the (async) persistence layer above to the synchronous
// ICognitoStorage interface the Cognito SDK requires — it calls these
// methods synchronously, so we maintain an in-memory cache that reads/writes
// sync and persists to `persist` in the background.
const memoryCache: Record<string, string> = {};

// SecureStore keys must be alphanumeric plus '.', '-', '_' — Cognito's own
// key names (CognitoIdentityServiceProvider.<clientId>.<username>.idToken,
// etc) are dot-separated already and satisfy this, so no extra encoding step
// is needed; this guard exists only to fail safe (skip persistence, keep the
// in-memory copy) if that ever changes, rather than crash on a thrown
// SecureStore validation error.
const SECURE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

const cognitoStorage: ICognitoStorage = {
  getItem(key: string): string | null {
    return memoryCache[key] ?? null;
  },
  setItem(key: string, value: string): void {
    memoryCache[key] = value;
    if (!isNative || SECURE_KEY_PATTERN.test(key)) {
      persist.setItem(key, value).catch((err) =>
        logger.warn('Cognito token persistence write failed (session kept in memory only)', { key, err: String(err) })
      );
    }
  },
  removeItem(key: string): void {
    delete memoryCache[key];
    persist.removeItem(key).catch(() => {});
  },
  clear(): void {
    const keys = Object.keys(memoryCache);
    keys.forEach(k => delete memoryCache[k]);
    keys.forEach(k => { persist.removeItem(k).catch(() => {}); });
  },
};

// Pre-load cached Cognito keys on startup.
async function hydrateCognitoStorage() {
  try {
    if (isNative) {
      // SecureStore has no key-listing API, unlike AsyncStorage, so we
      // reconstruct the exact key names Cognito's SDK always writes (the
      // same four suffixes, namespaced by clientId + username) starting
      // from its one discoverable anchor, LastAuthUser.
      if (!USER_POOL_CLIENT_ID) return;
      const base = `CognitoIdentityServiceProvider.${USER_POOL_CLIENT_ID}`;
      const lastUserKey = `${base}.LastAuthUser`;

      const lastUser = await SecureStore.getItemAsync(lastUserKey);
      if (!lastUser) return;
      memoryCache[lastUserKey] = lastUser;

      const userBase = `${base}.${lastUser}`;
      const suffixes = ['idToken', 'accessToken', 'refreshToken', 'clockDrift'];
      await Promise.all(suffixes.map(async (suffix) => {
        const key = `${userBase}.${suffix}`;
        const value = await SecureStore.getItemAsync(key);
        if (value !== null) memoryCache[key] = value;
      }));
    } else {
      const allKeys = await AsyncStorage.getAllKeys();
      const cognitoKeys = allKeys.filter(k => k.startsWith('CognitoIdentityServiceProvider'));
      if (cognitoKeys.length > 0) {
        const pairs = await AsyncStorage.multiGet(cognitoKeys);
        pairs.forEach(([key, value]) => {
          if (value !== null) memoryCache[key] = value;
        });
      }
    }
  } catch (err) {
    // Fresh start — next login simply re-populates storage.
    logger.warn('Cognito session hydration failed', { err: String(err) });
  }
}
hydrateCognitoStorage();

// Don't crash if AWS env vars are missing (offline mode)
let userPool: CognitoUserPool | null = null;

if (USER_POOL_ID && USER_POOL_CLIENT_ID) {
  userPool = new CognitoUserPool({
    UserPoolId: USER_POOL_ID,
    ClientId: USER_POOL_CLIENT_ID,
    Storage: cognitoStorage,
  });
  console.log('✅ AWS Cognito User Pool initialized');
} else {
  console.warn('⚠️ AWS env vars missing — running in offline mode');
}

export { userPool, cognitoStorage, AWS_REGION, USER_POOL_ID };
