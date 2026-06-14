import React, { createContext, useState, useEffect, useContext } from 'react';
import {
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userPool, cognitoStorage } from '@/lib/aws';
import { dynamoService } from '@/services/dynamoService';
import { ttsService } from '@/services/ttsService';
import { UserSettings, UserRole } from '@/types';
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE } from '@/lib/constants';

const VIEW_MODE_KEY = '@rbac_view_mode';

interface AppUser {
  id: string;
  email: string;
  role: UserRole;
}

interface AuthContextType {
  user: AppUser | null;
  settings: UserSettings | null;
  loading: boolean;
  needsNewPassword: boolean;
  needsConfirmation: boolean;
  pendingEmail: string | null;
  viewMode: 'admin' | 'user';
  setViewMode: (mode: 'admin' | 'user') => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  completeNewPassword: (newPassword: string) => Promise<void>;
  updateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Default settings used when AWS is unavailable (offline / APK mode)
const OFFLINE_SETTINGS: UserSettings = {
  user_id: 'offline-user',
  default_source_language: DEFAULT_SOURCE_LANGUAGE,
  default_target_language: DEFAULT_TARGET_LANGUAGE,
  tts_provider: 'device',
  conversation_mode_default: false,
  updated_at: new Date().toISOString(),
};

// Offline mode = developer mode → always OWNER
const OFFLINE_USER: AppUser = { id: 'offline-user', email: 'offline@local', role: 'OWNER' };

/** Extract UserRole from a Cognito JWT payload.
 *  API Gateway passes cognito:groups as a comma-separated string. */
function extractRole(payload: Record<string, unknown>): UserRole {
  const groups = payload['cognito:groups'];
  const groupArray = Array.isArray(groups)
    ? (groups as string[])
    : typeof groups === 'string'
    ? groups.split(',').map((g) => g.trim()).filter(Boolean)
    : [];
  return groupArray.includes('owner') ? 'OWNER' : 'USER';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [pendingCognitoUser, setPendingCognitoUser] = useState<CognitoUser | null>(null);
  const [pendingUserAttributes, setPendingUserAttributes] = useState<Record<string, string>>({});
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<'admin' | 'user'>('admin');

  useEffect(() => {
    // Hydrate persisted view mode preference
    AsyncStorage.getItem(VIEW_MODE_KEY).then((stored) => {
      if (stored === 'user' || stored === 'admin') {
        setViewModeState(stored);
      }
    }).catch(() => {});

    // If Cognito is not available, use offline mode immediately
    if (!userPool) {
      console.log('📱 Running in offline mode (no AWS Cognito)');
      setUser(OFFLINE_USER);
      setSettings(OFFLINE_SETTINGS);
      setLoading(false);
      return;
    }

    // Try to restore existing session
    const currentUser = userPool.getCurrentUser();
    if (currentUser) {
      currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          console.log('📱 No valid session, user needs to sign in');
          setLoading(false);
          return;
        }

        const idToken = session.getIdToken().getJwtToken();
        const payload = session.getIdToken().payload;
        const userId = payload['sub'] as string;
        const email = payload['email'] as string;
        const role = extractRole(payload);

        console.log(`✅ Session restored for ${email} (role: ${role})`);
        dynamoService.initialize(idToken);
        setUser({ id: userId, email, role });
        loadUserSettings(userId);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const setViewMode = (mode: 'admin' | 'user') => {
    setViewModeState(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode).catch(() => {});
  };

  const loadUserSettings = async (userId: string) => {
    try {
      const data = await dynamoService.getUserSettings(userId);

      if (!data) {
        // No settings yet — create defaults
        const defaultSettings: UserSettings = {
          user_id: userId,
          default_source_language: DEFAULT_SOURCE_LANGUAGE,
          default_target_language: DEFAULT_TARGET_LANGUAGE,
          tts_provider: 'device',
          conversation_mode_default: false,
          updated_at: new Date().toISOString(),
        };

        await dynamoService.putUserSettings(defaultSettings);
        ttsService.setCustomVoiceId(null);
        setSettings(defaultSettings);
      } else {
        // Restore custom voice and gender preference
        ttsService.setCustomVoiceId(data.custom_voice_id || null);
        ttsService.setVoiceGender(data.voice_gender || 'female');
        setSettings(data);
      }
    } catch (err) {
      console.error('Error in loadUserSettings:', err);
      setSettings(OFFLINE_SETTINGS);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    if (!userPool) throw new Error('Offline mode — sign in not available');

    return new Promise<void>((resolve, reject) => {
      // Clear any stale cached session from a previous user before authenticating
      const existingUser = userPool!.getCurrentUser();
      if (existingUser) {
        existingUser.signOut();
      }

      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool!,
        Storage: cognitoStorage,
      });

      const authDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session: CognitoUserSession) => {
          const idToken = session.getIdToken().getJwtToken();
          const payload = session.getIdToken().payload;
          const userId = payload['sub'] as string;
          const role = extractRole(payload);

          console.log(`✅ Signed in: ${email} (role: ${role})`);
          setNeedsNewPassword(false);
          setPendingCognitoUser(null);
          dynamoService.initialize(idToken);
          setUser({ id: userId, email, role });
          loadUserSettings(userId);
          resolve();
        },
        onFailure: (err: Error & { code?: string }) => {
          if (err.code === 'UserNotConfirmedException' || err.message === 'User is not confirmed.') {
            console.log('📧 User not confirmed, resending verification code...');
            setPendingEmail(email);
            setNeedsConfirmation(true);
            // Resend the confirmation code
            cognitoUser.resendConfirmationCode((resendErr) => {
              if (resendErr) {
                console.error('❌ Failed to resend code:', resendErr.message);
              } else {
                console.log('✅ Verification code resent');
              }
            });
            resolve(); // let the UI show confirmation screen
            return;
          }
          console.error('❌ Sign in failed:', err.message);
          reject(err);
        },
        newPasswordRequired: (userAttributes: Record<string, string>) => {
          console.log('🔑 New password required for user');
          // Remove non-writable attributes that Cognito returns but doesn't accept back
          delete userAttributes.email_verified;
          delete userAttributes.email;
          setPendingCognitoUser(cognitoUser);
          setPendingUserAttributes(userAttributes);
          setNeedsNewPassword(true);
          resolve(); // resolve so the UI can show the new password form
        },
      });
    });
  };

  const signUp = async (email: string, password: string) => {
    if (!userPool) throw new Error('Offline mode — sign up not available');

    return new Promise<void>((resolve, reject) => {
      const attributes = [
        new CognitoUserAttribute({ Name: 'email', Value: email }),
      ];

      userPool!.signUp(email, password, attributes, [], (err, result) => {
        if (err) {
          console.error('❌ Sign up failed:', err.message);
          reject(err);
          return;
        }
        console.log(`✅ Sign up successful: ${email}`);
        // Check if user needs email confirmation
        if (result && !result.userConfirmed) {
          setPendingEmail(email);
          setNeedsConfirmation(true);
        }
        resolve();
      });
    });
  };

  const confirmSignUp = async (email: string, code: string) => {
    if (!userPool) throw new Error('Offline mode — confirmation not available');

    return new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool!,
        Storage: cognitoStorage,
      });

      cognitoUser.confirmRegistration(code, true, (err, result) => {
        if (err) {
          console.error('❌ Confirmation failed:', err.message);
          reject(err);
          return;
        }
        console.log(`✅ Email confirmed for ${email}`);
        setNeedsConfirmation(false);
        setPendingEmail(null);
        resolve();
      });
    });
  };

  const completeNewPassword = async (newPassword: string) => {
    if (!pendingCognitoUser) throw new Error('No pending password challenge');

    return new Promise<void>((resolve, reject) => {
      pendingCognitoUser.completeNewPasswordChallenge(newPassword, pendingUserAttributes, {
        onSuccess: (session: CognitoUserSession) => {
          const idToken = session.getIdToken().getJwtToken();
          const payload = session.getIdToken().payload;
          const userId = payload['sub'] as string;
          const email = payload['email'] as string;
          const role = extractRole(payload);

          console.log(`✅ Password updated and signed in: ${email} (role: ${role})`);
          setNeedsNewPassword(false);
          setPendingCognitoUser(null);
          setPendingUserAttributes({});
          dynamoService.initialize(idToken);
          setUser({ id: userId, email, role });
          loadUserSettings(userId);
          resolve();
        },
        onFailure: (err: Error) => {
          console.error('❌ New password challenge failed:', err.message);
          reject(err);
        },
      });
    });
  };

  const signOut = async () => {
    if (!userPool) throw new Error('Offline mode — sign out not available');

    const currentUser = userPool.getCurrentUser();
    if (currentUser) {
      currentUser.signOut();
    }

    ttsService.setCustomVoiceId(null);
    ttsService.setVoiceGender('female');
    setUser(null);
    setSettings(null);
    // Reset view mode to admin when signing out
    setViewModeState('admin');
    AsyncStorage.removeItem(VIEW_MODE_KEY).catch(() => {});
    console.log('✅ Signed out');
  };

  const updateSettings = async (newSettings: Partial<UserSettings>) => {
    if (!user) return;

    if (!dynamoService.isInitialized()) {
      // Offline: update local settings only
      setSettings(prev => prev ? { ...prev, ...newSettings, updated_at: new Date().toISOString() } : null);
      return;
    }

    const updated = await dynamoService.updateUserSettings(user.id, newSettings);
    if (updated) {
      setSettings(updated);
    }
  };

  const refreshSettings = async () => {
    if (user && user.id !== 'offline-user') {
      await loadUserSettings(user.id);
    }
  };

  const value = {
    user,
    settings,
    loading,
    needsNewPassword,
    needsConfirmation,
    pendingEmail,
    viewMode,
    setViewMode,
    signIn,
    signUp,
    confirmSignUp,
    signOut,
    completeNewPassword,
    updateSettings,
    refreshSettings,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
