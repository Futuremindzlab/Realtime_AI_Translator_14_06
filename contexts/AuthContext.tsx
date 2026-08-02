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
import { isNetworkError } from '@/lib/errors';
import { logger } from '@/lib/logger';

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
  needsOtpVerification: boolean;
  pendingPhone: string | null;
  viewMode: 'admin' | 'user';
  setViewMode: (mode: 'admin' | 'user') => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signInWithPhone: (e164Phone: string) => Promise<void>;
  confirmOtpCode: (code: string) => Promise<void>;
  cancelPhoneVerification: () => void;
  signOut: () => Promise<void>;
  completeNewPassword: (newPassword: string) => Promise<void>;
  updateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  refreshSettings: () => Promise<void>;
  /** Re-fetches the Cognito session, transparently refreshing an expired ID
   *  token via the cached refresh token. Returns false if there's no signed-in
   *  user or the refresh token itself is no longer valid (re-sign-in needed). */
  refreshSession: () => Promise<boolean>;
  needsForgotPasswordCode: boolean;
  pendingForgotPasswordEmail: string | null;
  forgotPassword: (email: string) => Promise<void>;
  confirmForgotPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  cancelForgotPassword: () => void;
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
  const [needsOtpVerification, setNeedsOtpVerification] = useState(false);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [needsForgotPasswordCode, setNeedsForgotPasswordCode] = useState(false);
  const [pendingForgotPasswordEmail, setPendingForgotPasswordEmail] = useState<string | null>(null);
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
        // Phone-based accounts have a synthetic placeholder email (see backend/src/phone.mjs
        // derivePhoneUsername) — prefer the real phone_number claim when present so a
        // restored session doesn't display the internal placeholder to the user.
        const displayId = (payload['phone_number'] as string) || (payload['email'] as string);
        const role = extractRole(payload);

        console.log(`✅ Session restored for ${displayId} (role: ${role})`);
        dynamoService.initialize(idToken);
        setUser({ id: userId, email: displayId, role });
        loadUserSettings(userId);
      });
    } else {
      setLoading(false);
    }
  }, []);

  /**
   * Re-fetches the Cognito session. amazon-cognito-identity-js's getSession()
   * transparently calls refreshSession() under the hood via the cached refresh
   * token when the cached ID/access token has expired, so this is enough to
   * recover from the 1-hour ID token expiry without a full re-login — as long
   * as the ~30-day refresh token itself is still valid.
   */
  const refreshSession = async (): Promise<boolean> => {
    if (!userPool) return true; // offline mode — nothing to refresh
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) return false;

    return new Promise<boolean>((resolve) => {
      currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          console.warn('⚠️ Session refresh failed — refresh token expired, re-sign-in needed');
          resolve(false);
          return;
        }
        const idToken = session.getIdToken().getJwtToken();
        dynamoService.initialize(idToken);
        console.log('🔄 Session refreshed');
        resolve(true);
      });
    });
  };

  // Let any backend call (translations/settings CRUD, AI proxy) self-heal from
  // an expired token instead of failing for the rest of the session.
  useEffect(() => {
    dynamoService.setSessionRefreshHandler(refreshSession);
    return () => dynamoService.setSessionRefreshHandler(null);
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

  /** Kicks off Cognito's forgot-password flow — sends a verification code to
   *  the account's email. Only applies to email accounts; phone accounts sign
   *  in passwordlessly via OTP (see signInWithPhone) and have no password to reset. */
  const forgotPassword = async (email: string) => {
    if (!userPool) throw new Error('Offline mode — password reset not available');

    return new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool!,
        Storage: cognitoStorage,
      });

      cognitoUser.forgotPassword({
        onSuccess: () => {
          // Cognito's ForgotPassword API always returns success even for an
          // unknown username (anti user-enumeration) — same UX either way.
          console.log(`📧 Password reset code requested for ${email}`);
          setPendingForgotPasswordEmail(email);
          setNeedsForgotPasswordCode(true);
          resolve();
        },
        onFailure: (err: Error & { code?: string }) => {
          // amazon-cognito-identity-js makes a raw HTTP call here — on a native
          // (APK) device a transient connectivity blip surfaces as an opaque
          // "Network error" from the SDK, easy to mistake for the feature being
          // broken. Log it distinctly (code + message) and give the user an
          // actionable message instead of whatever raw string the SDK produced.
          logger.error('Forgot-password request failed', err, { email, code: err.code });
          if (isNetworkError(err)) {
            reject(new Error('Unable to reach the server — check your internet connection and try again.'));
            return;
          }
          reject(err);
        },
      });
    });
  };

  /** Completes the forgot-password flow with the emailed code + a new password. */
  const confirmForgotPassword = async (email: string, code: string, newPassword: string) => {
    if (!userPool) throw new Error('Offline mode — password reset not available');

    return new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool!,
        Storage: cognitoStorage,
      });

      cognitoUser.confirmPassword(code, newPassword, {
        onSuccess: () => {
          console.log(`✅ Password reset for ${email}`);
          setNeedsForgotPasswordCode(false);
          setPendingForgotPasswordEmail(null);
          resolve();
        },
        onFailure: (err: Error & { code?: string }) => {
          logger.error('Password reset confirmation failed', err, { email, code: err.code });
          if (isNetworkError(err)) {
            reject(new Error('Unable to reach the server — check your internet connection and try again.'));
            return;
          }
          reject(err);
        },
      });
    });
  };

  /** Lets the user back out of the forgot-password flow (wrong email, changed mind). */
  const cancelForgotPassword = () => {
    setNeedsForgotPasswordCode(false);
    setPendingForgotPasswordEmail(null);
  };

  const signInWithPhone = async (e164Phone: string) => {
    if (!userPool) throw new Error('Offline mode — sign in not available');

    // Ensure the Cognito user exists BEFORE calling initiateAuth. This pool has
    // UsernameAttributes=['email'] with no phone alias (both immutable), so
    // Cognito can't look users up by raw phone number — the backend derives and
    // returns the deterministic Username to use instead. Pre-creating here (rather
    // than inside the CreateAuthChallenge trigger via request.userNotFound) avoids
    // relying on Cognito's user-existence-suppression to still issue real tokens
    // for a user created mid-session, which isn't a guaranteed behavior.
    const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
    if (!apiBase) throw new Error('EXPO_PUBLIC_API_BASE_URL is not set in .env');

    const otpResponse = await fetch(`${apiBase}/v1/auth/phone/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: e164Phone }),
    });

    if (!otpResponse.ok) {
      const errBody = await otpResponse.json().catch(() => ({}));
      throw new Error(errBody.error || `Failed to start phone sign-in (${otpResponse.status})`);
    }

    const { username } = await otpResponse.json();

    return new Promise<void>((resolve, reject) => {
      const existingUser = userPool!.getCurrentUser();
      if (existingUser) {
        existingUser.signOut();
      }

      const cognitoUser = new CognitoUser({
        Username: username,
        Pool: userPool!,
        Storage: cognitoStorage,
      });
      cognitoUser.setAuthenticationFlowType('CUSTOM_AUTH');

      const authDetails = new AuthenticationDetails({ Username: username });

      cognitoUser.initiateAuth(authDetails, {
        onSuccess: () => {
          // Shouldn't happen for CUSTOM_AUTH without a challenge, but handle defensively.
          reject(new Error('Unexpected sign-in success without OTP challenge'));
        },
        onFailure: (err: Error) => {
          console.error('❌ Phone sign in failed:', err.message);
          reject(err);
        },
        customChallenge: () => {
          console.log(`📱 OTP challenge issued for ${e164Phone}`);
          setPendingCognitoUser(cognitoUser);
          setPendingPhone(e164Phone);
          setNeedsOtpVerification(true);
          resolve();
        },
      });
    });
  };

  const confirmOtpCode = async (code: string) => {
    if (!pendingCognitoUser) throw new Error('No pending phone sign-in');

    return new Promise<void>((resolve, reject) => {
      pendingCognitoUser.sendCustomChallengeAnswer(code, {
        onSuccess: (session: CognitoUserSession) => {
          const idToken = session.getIdToken().getJwtToken();
          const payload = session.getIdToken().payload;
          const userId = payload['sub'] as string;
          const phone = (payload['phone_number'] as string) || pendingPhone || '';
          const role = extractRole(payload);

          console.log(`✅ Signed in via phone: ${phone} (role: ${role})`);
          setNeedsOtpVerification(false);
          setPendingCognitoUser(null);
          setPendingPhone(null);
          dynamoService.initialize(idToken);
          setUser({ id: userId, email: phone, role });
          loadUserSettings(userId);
          resolve();
        },
        onFailure: (err: Error) => {
          // Terminal failure (e.g. too many wrong attempts — see defineAuthChallenge.mjs's
          // MAX_ATTEMPTS) — reset so the user isn't stuck on the OTP screen with no way
          // back except restarting the app.
          console.error('❌ OTP verification failed:', err.message);
          setNeedsOtpVerification(false);
          setPendingCognitoUser(null);
          setPendingPhone(null);
          reject(err);
        },
        customChallenge: () => {
          // Wrong code — Cognito re-issued the challenge; let the user retry.
          reject(new Error('Incorrect code. Please try again.'));
        },
      });
    });
  };

  /** Lets the user back out of the phone-OTP flow (wrong number, no SMS received, etc.). */
  const cancelPhoneVerification = () => {
    setNeedsOtpVerification(false);
    setPendingCognitoUser(null);
    setPendingPhone(null);
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
    setNeedsOtpVerification(false);
    setPendingPhone(null);
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
    needsOtpVerification,
    pendingPhone,
    viewMode,
    setViewMode,
    signIn,
    signUp,
    confirmSignUp,
    signInWithPhone,
    confirmOtpCode,
    cancelPhoneVerification,
    signOut,
    completeNewPassword,
    updateSettings,
    refreshSettings,
    refreshSession,
    needsForgotPasswordCode,
    pendingForgotPasswordEmail,
    forgotPassword,
    confirmForgotPassword,
    cancelForgotPassword,
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
