/**
 * AWS client setup — Cognito only.
 *
 * DynamoDB is now accessed via API Gateway + Lambda (see backend/).
 * The DynamoDB SDK and Identity Pool credentials are no longer needed here.
 */
import { CognitoUserPool, ICognitoStorage } from 'amazon-cognito-identity-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const AWS_REGION          = process.env.EXPO_PUBLIC_AWS_REGION               || '';
const USER_POOL_ID        = process.env.EXPO_PUBLIC_AWS_USER_POOL_ID         || '';
const USER_POOL_CLIENT_ID = process.env.EXPO_PUBLIC_AWS_USER_POOL_CLIENT_ID  || '';

// Bridge AsyncStorage to the synchronous ICognitoStorage interface.
// Cognito SDK calls these methods synchronously, but AsyncStorage is async.
// We maintain an in-memory cache that syncs to AsyncStorage in the background.
const memoryCache: Record<string, string> = {};

const cognitoStorage: ICognitoStorage = {
  getItem(key: string): string | null {
    return memoryCache[key] ?? null;
  },
  setItem(key: string, value: string): void {
    memoryCache[key] = value;
    // Persisting is best-effort (the in-memory cache is authoritative for this
    // session), but a failure means the session won't survive a restart.
    AsyncStorage.setItem(key, value).catch((err) =>
      logger.warn('Failed to persist Cognito session key', { key, error: errorMessage(err) }));
  },
  removeItem(key: string): void {
    delete memoryCache[key];
    AsyncStorage.removeItem(key).catch((err) =>
      logger.warn('Failed to remove Cognito session key', { key, error: errorMessage(err) }));
  },
  clear(): void {
    Object.keys(memoryCache).forEach(k => delete memoryCache[k]);
    AsyncStorage.clear().catch((err) =>
      logger.warn('Failed to clear Cognito session storage', { error: errorMessage(err) }));
  },
};

// Pre-load cached Cognito keys from AsyncStorage on startup
async function hydrateCognitoStorage() {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cognitoKeys = allKeys.filter(k => k.startsWith('CognitoIdentityServiceProvider'));
    if (cognitoKeys.length > 0) {
      const pairs = await AsyncStorage.multiGet(cognitoKeys);
      pairs.forEach(([key, value]) => {
        if (value !== null) memoryCache[key] = value;
      });
    }
  } catch (err) {
    // Recoverable — the user just has to sign in again — but never invisible.
    logger.warn('Cognito session hydration failed — starting fresh', { error: errorMessage(err) });
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
