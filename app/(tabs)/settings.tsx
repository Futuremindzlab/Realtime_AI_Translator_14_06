import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { LogIn, LogOut, Save, Mic, Trash2 } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { audioService } from '@/services/audioService';
import { ttsService, TTSService } from '@/services/ttsService';
import { CountryCodeSelector } from '@/components/CountryCodeSelector';

export default function SettingsScreen() {
  const {
    user, settings, signIn, signUp, confirmSignUp, signInWithPhone, confirmOtpCode, cancelPhoneVerification,
    signOut, completeNewPassword, updateSettings, loading,
    needsNewPassword, needsConfirmation, pendingEmail, needsOtpVerification, pendingPhone,
    viewMode, setViewMode,
  } = useAuth();
  const isUserView = user?.role === 'USER' || viewMode === 'user';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  const [authMode, setAuthMode] = useState<'email' | 'phone'>('email');
  const [dialCode, setDialCode] = useState('+91');
  const [phoneNational, setPhoneNational] = useState('');
  const [otpCode, setOtpCode] = useState('');

  const [ttsProvider, setTtsProvider] = useState<'inworld' | 'elevenlabs' | 'openai' | 'device' | 'azure'>('device');
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('female');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [conversationModeDefault, setConversationModeDefault] = useState(true);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isCloningVoice, setIsCloningVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [authError, setAuthError] = useState<string | null>(null);

  React.useEffect(() => {
    if (settings) {
      setTtsProvider(settings.tts_provider);
      setConversationModeDefault(settings.conversation_mode_default);
      setVoiceGender(settings.voice_gender || 'female');
      setSelectedVoiceId(settings.selected_voice_id || null);
      ttsService.setCustomVoiceId(settings.custom_voice_id || null);
      ttsService.setVoiceGender(settings.voice_gender || 'female');
      ttsService.setSelectedVoiceId(settings.selected_voice_id || null);
    }
  }, [settings]);

  const handleAuth = async () => {
    if (!email || !password) {
      setAuthError('Please enter both email and password');
      return;
    }
    setAuthError(null);
    setAuthLoading(true);
    try {
      if (isLogin) {
        await signIn(email, password);
        setEmail('');
        setPassword('');
      } else {
        await signUp(email, password);
        setPassword('');
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleNewPassword = async () => {
    if (!newPassword || !confirmNewPassword) {
      setAuthError('Please fill in both password fields');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setAuthError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setAuthError('Password must be at least 8 characters');
      return;
    }
    setAuthError(null);
    setAuthLoading(true);
    try {
      await completeNewPassword(newPassword);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Failed to set new password');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleConfirmSignUp = async () => {
    const emailToConfirm = pendingEmail || email;
    if (!emailToConfirm || !confirmationCode) {
      setAuthError('Please enter the verification code');
      return;
    }
    setAuthError(null);
    setAuthLoading(true);
    try {
      await confirmSignUp(emailToConfirm, confirmationCode);
      setConfirmationCode('');
      setIsLogin(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSendOtp = async () => {
    const trimmed = phoneNational.trim();
    // If the user pasted an already-fully-qualified international number
    // (e.g. copied from another app as "+919876543210"), use it as-is instead
    // of also prepending the selected dial code — otherwise the country code
    // gets duplicated (+91 + "+919876543210" digits → wrong number, silent).
    const composed = trimmed.startsWith('+')
      ? `+${trimmed.replace(/\D/g, '')}`
      : `${dialCode}${trimmed.replace(/\D/g, '').replace(/^0+/, '')}`;

    if (composed.replace(/\D/g, '').length === 0) {
      setAuthError('Please enter your phone number');
      return;
    }
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signInWithPhone(composed);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Failed to send verification code');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode) {
      setAuthError('Please enter the verification code');
      return;
    }
    setAuthError(null);
    setAuthLoading(true);
    try {
      await confirmOtpCode(otpCode);
      setOtpCode('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      Alert.alert('Success', 'Signed out successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to sign out');
    }
  };

  const handleSaveSettings = async () => {
    if (!user) {
      Alert.alert('Error', 'Please sign in to save settings');
      return;
    }

    try {
      ttsService.setVoiceGender(voiceGender);
      ttsService.setSelectedVoiceId(selectedVoiceId);
      await updateSettings({
        ...(isUserView ? {} : { tts_provider: ttsProvider }),
        conversation_mode_default: conversationModeDefault,
        voice_gender: voiceGender,
        selected_voice_id: selectedVoiceId || undefined,
      });
      Alert.alert('Success', 'Settings saved successfully!');
    } catch (error) {
      console.error('Settings save error:', error);
      Alert.alert('Error', 'Failed to save settings. Please try again.');
    }
  };

  const handleStartVoiceRecording = async () => {
    try {
      setIsRecordingVoice(true);
      setRecordingSeconds(0);
      await audioService.startRecording();

      // USER view: auto-stop at 30s; OWNER view: auto-stop at 60s
      const maxSeconds = isUserView ? 29 : 59;

      // Count seconds while recording
      const interval = setInterval(() => {
        setRecordingSeconds(prev => {
          if (prev >= maxSeconds) {
            clearInterval(interval);
            handleStopVoiceRecording();
            return maxSeconds + 1;
          }
          return prev + 1;
        });
      }, 1000);

      // Store interval ID for cleanup
      (handleStartVoiceRecording as any)._interval = interval;
    } catch (error) {
      setIsRecordingVoice(false);
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const handleStopVoiceRecording = async () => {
    try {
      // Clear the timer
      if ((handleStartVoiceRecording as any)._interval) {
        clearInterval((handleStartVoiceRecording as any)._interval);
      }
      setIsRecordingVoice(false);

      // OWNER view only: enforce 10s minimum with a clear message
      if (!isUserView && recordingSeconds < 10) {
        await audioService.stopRecording();
        Alert.alert('Too Short', 'Please record at least 10 seconds of speech for voice cloning.');
        return;
      }

      setIsCloningVoice(true);
      const audioUri = await audioService.stopRecording();

      if (!audioUri) {
        throw new Error('No audio recorded');
      }

      const voiceName = `MyVoice_${user?.email?.split('@')[0] || 'user'}`;
      const voiceId = await ttsService.cloneVoice(audioUri, voiceName);

      // Save to settings and activate
      ttsService.setCustomVoiceId(voiceId);
      await updateSettings({ custom_voice_id: voiceId, tts_provider: 'elevenlabs' });
      setTtsProvider('elevenlabs');

      Alert.alert('Voice Applied', 'Your voice is now active. Future translations will sound like you.');
    } catch (error) {
      console.error('Voice cloning error:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Voice cloning failed');
    } finally {
      setIsCloningVoice(false);
      setRecordingSeconds(0);
    }
  };

  const handleRemoveCustomVoice = async () => {
    Alert.alert(
      'Remove Custom Voice',
      'This will remove your cloned voice and revert to default voices.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            ttsService.setCustomVoiceId(null);
            await updateSettings({ custom_voice_id: '' });
            Alert.alert('Success', 'Custom voice removed');
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Configure your preferences</Text>
      </View>

      {needsNewPassword ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Set New Password</Text>
          <Text style={styles.sectionDescription}>
            Your account requires a new password. Please set one to continue.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="New Password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
          />

          <TextInput
            style={styles.input}
            placeholder="Confirm New Password"
            value={confirmNewPassword}
            onChangeText={setConfirmNewPassword}
            secureTextEntry
          />

          {authError && <Text style={styles.authError}>{authError}</Text>}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleNewPassword}
            disabled={authLoading}>
            {authLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Set Password & Sign In</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : needsConfirmation ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Verify Your Email</Text>
          <Text style={styles.sectionDescription}>
            We sent a verification code to {pendingEmail || email}. Enter it below to complete registration.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Verification Code"
            value={confirmationCode}
            onChangeText={setConfirmationCode}
            keyboardType="number-pad"
            autoCapitalize="none"
          />

          {authError && <Text style={styles.authError}>{authError}</Text>}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleConfirmSignUp}
            disabled={authLoading}>
            {authLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Verify & Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : needsOtpVerification ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Enter Verification Code</Text>
          <Text style={styles.sectionDescription}>
            We sent a code via SMS to {pendingPhone}. Enter it below to sign in.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            value={otpCode}
            onChangeText={setOtpCode}
            keyboardType="number-pad"
            autoCapitalize="none"
          />

          {authError && <Text style={styles.authError}>{authError}</Text>}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleVerifyOtp}
            disabled={authLoading}>
            {authLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Verify & Continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => { setAuthError(null); setOtpCode(''); cancelPhoneVerification(); }}>
            <Text style={styles.linkText}>Entered the wrong number? Start over</Text>
          </TouchableOpacity>
        </View>
      ) : !user ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            {authMode === 'email' ? (isLogin ? 'Sign In' : 'Create Account') : 'Sign In with Phone'}
          </Text>
          <Text style={styles.sectionDescription}>
            Sign in to save your translation history and settings
          </Text>

          {authMode === 'email' ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <TextInput
                style={styles.input}
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              {!isLogin && (
                <Text style={styles.passwordHint}>
                  Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.
                </Text>
              )}
              {authError && <Text style={styles.authError}>{authError}</Text>}

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleAuth}
                disabled={authLoading}>
                {authLoading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <LogIn size={20} color="#ffffff" />
                    <Text style={styles.primaryButtonText}>
                      {isLogin ? 'Sign In' : 'Sign Up'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
                <Text style={styles.linkText}>
                  {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.phoneRow}>
                <CountryCodeSelector selectedDialCode={dialCode} onSelect={setDialCode} />
                <TextInput
                  style={[styles.input, styles.phoneInput]}
                  placeholder="Phone number"
                  value={phoneNational}
                  onChangeText={setPhoneNational}
                  keyboardType="phone-pad"
                />
              </View>
              {authError && <Text style={styles.authError}>{authError}</Text>}

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleSendOtp}
                disabled={authLoading}>
                {authLoading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <LogIn size={20} color="#ffffff" />
                    <Text style={styles.primaryButtonText}>Send Code</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity onPress={() => { setAuthError(null); setAuthMode(authMode === 'email' ? 'phone' : 'email'); }}>
            <Text style={styles.linkText}>
              {authMode === 'email' ? 'Sign in with phone instead' : 'Sign in with email instead'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Account</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleSignOut}>
              <LogOut size={20} color="#ef4444" />
              <Text style={styles.secondaryButtonText}>Sign Out</Text>
            </TouchableOpacity>
          </View>

          {user?.role === 'OWNER' && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Developer Mode</Text>
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.switchLabel}>Admin View</Text>
                  <Text style={styles.switchDescription}>Toggle off to preview User experience</Text>
                </View>
                <Switch
                  value={viewMode === 'admin'}
                  onValueChange={(v) => setViewMode(v ? 'admin' : 'user')}
                  trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
                  thumbColor={viewMode === 'admin' ? '#2563eb' : '#f4f3f4'}
                />
              </View>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Preferences</Text>

            {!isUserView && (
              <>
                <Text style={styles.inputLabel}>TTS Provider</Text>
                <View style={styles.radioGroup}>
                  <TouchableOpacity
                    style={styles.radioOption}
                    onPress={() => setTtsProvider('openai')}>
                    <View style={[styles.radio, ttsProvider === 'openai' && styles.radioSelected]}>
                      {ttsProvider === 'openai' && <View style={styles.radioDot} />}
                    </View>
                    <View>
                      <Text style={styles.radioLabel}>OpenAI TTS</Text>
                      <Text style={styles.voiceDesc}>Cloud · High quality · Requires API key</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.radioOption}
                    onPress={() => setTtsProvider('elevenlabs')}>
                    <View style={[styles.radio, ttsProvider === 'elevenlabs' && styles.radioSelected]}>
                      {ttsProvider === 'elevenlabs' && <View style={styles.radioDot} />}
                    </View>
                    <View>
                      <Text style={styles.radioLabel}>ElevenLabs</Text>
                      <Text style={styles.voiceDesc}>Cloud · Best for Indian & Arabic · Requires API key</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.radioOption}
                    onPress={() => setTtsProvider('azure')}>
                    <View style={[styles.radio, ttsProvider === 'azure' && styles.radioSelected]}>
                      {ttsProvider === 'azure' && <View style={styles.radioDot} />}
                    </View>
                    <View>
                      <Text style={styles.radioLabel}>Azure Speech</Text>
                      <Text style={styles.voiceDesc}>Cloud · Native Malayalam voices · Requires API key</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.radioOption}
                    onPress={() => setTtsProvider('device')}>
                    <View style={[styles.radio, ttsProvider === 'device' && styles.radioSelected]}>
                      {ttsProvider === 'device' && <View style={styles.radioDot} />}
                    </View>
                    <View>
                      <Text style={styles.radioLabel}>Device TTS</Text>
                      <Text style={styles.voiceDesc}>Free · Offline · Indian/Arabic auto-upgrade to ElevenLabs</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <Text style={styles.inputLabel}>Voice</Text>
            {ttsProvider === 'openai' && (
              <View style={styles.radioGroup}>
                {TTSService.OPENAI_VOICES.map(v => (
                  <TouchableOpacity
                    key={v.id}
                    style={styles.radioOption}
                    onPress={() => { setSelectedVoiceId(v.id); setVoiceGender(v.gender === 'male' ? 'male' : 'female'); }}>
                    <View style={[styles.radio, selectedVoiceId === v.id && styles.radioSelected]}>
                      {selectedVoiceId === v.id && <View style={styles.radioDot} />}
                    </View>
                    <View>
                      <Text style={styles.radioLabel}>{v.label}</Text>
                      <Text style={styles.voiceDesc}>{v.desc}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {ttsProvider === 'elevenlabs' && (
              <View style={styles.radioGroup}>
                {TTSService.ELEVENLABS_VOICES.map(v => (
                  <TouchableOpacity
                    key={v.id}
                    style={styles.radioOption}
                    onPress={() => { setSelectedVoiceId(v.id); setVoiceGender(v.gender === 'male' ? 'male' : 'female'); }}>
                    <View style={[styles.radio, selectedVoiceId === v.id && styles.radioSelected]}>
                      {selectedVoiceId === v.id && <View style={styles.radioDot} />}
                    </View>
                    <View>
                      <Text style={styles.radioLabel}>{v.label}</Text>
                      <Text style={styles.voiceDesc}>{v.desc}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {ttsProvider === 'device' && (
              <View style={styles.radioGroup}>
                <TouchableOpacity
                  style={styles.radioOption}
                  onPress={() => { setVoiceGender('female'); setSelectedVoiceId(null); }}>
                  <View style={[styles.radio, voiceGender === 'female' && styles.radioSelected]}>
                    {voiceGender === 'female' && <View style={styles.radioDot} />}
                  </View>
                  <View>
                    <Text style={styles.radioLabel}>Female Voice</Text>
                    <Text style={styles.voiceDesc}>Higher pitch · Device TTS · OpenAI Shimmer / ElevenLabs George</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.radioOption}
                  onPress={() => { setVoiceGender('male'); setSelectedVoiceId(null); }}>
                  <View style={[styles.radio, voiceGender === 'male' && styles.radioSelected]}>
                    {voiceGender === 'male' && <View style={styles.radioDot} />}
                  </View>
                  <View>
                    <Text style={styles.radioLabel}>Male Voice</Text>
                    <Text style={styles.voiceDesc}>Lower pitch · Device TTS · George (ElevenLabs) for Indian/Arabic</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
            {ttsProvider === 'azure' && (
              <View style={styles.radioGroup}>
                <TouchableOpacity
                  style={styles.radioOption}
                  onPress={() => { setVoiceGender('female'); setSelectedVoiceId(null); }}>
                  <View style={[styles.radio, voiceGender === 'female' && styles.radioSelected]}>
                    {voiceGender === 'female' && <View style={styles.radioDot} />}
                  </View>
                  <View>
                    <Text style={styles.radioLabel}>Female Voice</Text>
                    <Text style={styles.voiceDesc}>Sobhana · Native Malayalam neural voice</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.radioOption}
                  onPress={() => { setVoiceGender('male'); setSelectedVoiceId(null); }}>
                  <View style={[styles.radio, voiceGender === 'male' && styles.radioSelected]}>
                    {voiceGender === 'male' && <View style={styles.radioDot} />}
                  </View>
                  <View>
                    <Text style={styles.radioLabel}>Male Voice</Text>
                    <Text style={styles.voiceDesc}>Midhun · Native Malayalam neural voice</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
            {ttsProvider === 'inworld' && (
              <Text style={styles.voiceHint}>Voice selection not available for this provider.</Text>
            )}

            <View style={styles.switchRow}>
              <View>
                <Text style={styles.switchLabel}>Auto Conversation Mode</Text>
                <Text style={styles.switchDescription}>Start in conversation mode by default</Text>
              </View>
              <Switch
                value={conversationModeDefault}
                onValueChange={setConversationModeDefault}
                trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
                thumbColor={conversationModeDefault ? '#2563eb' : '#f4f3f4'}
              />
            </View>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSaveSettings}>
              <Save size={20} color="#ffffff" />
              <Text style={styles.saveButtonText}>Save Preferences</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Voice Cloning</Text>
            <Text style={styles.sectionDescription}>
              {isUserView
                ? 'Record your voice to personalize translations.'
                : 'Clone your voice so translations sound like you. Record 30-60 seconds of clear speech. Works with ElevenLabs TTS.'}
            </Text>

            {settings?.custom_voice_id ? (
              <View>
                <View style={[styles.voiceStatus, { backgroundColor: '#ecfdf5' }]}>
                  <Text style={[styles.voiceStatusText, { color: '#059669' }]}>
                    {isUserView ? 'Custom voice active ✓' : 'Custom voice active'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.secondaryButton, { marginTop: 12 }]}
                  onPress={handleRemoveCustomVoice}>
                  <Trash2 size={18} color="#ef4444" />
                  <Text style={styles.secondaryButtonText}>
                    {isUserView ? 'Reset to Default Voice' : 'Remove Custom Voice'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : isCloningVoice ? (
              <View style={styles.cloningContainer}>
                <ActivityIndicator size="large" color="#2563eb" />
                <Text style={styles.cloningText}>
                  {isUserView ? 'Applying your voice...' : 'Cloning your voice...'}
                </Text>
                <Text style={styles.cloningSubtext}>This may take 15-30 seconds</Text>
              </View>
            ) : isRecordingVoice ? (
              <View>
                <View style={[styles.voiceStatus, { backgroundColor: '#fef2f2' }]}>
                  <Text style={[styles.voiceStatusText, { color: '#dc2626' }]}>
                    {isUserView
                      ? `Recording... ${recordingSeconds}s`
                      : `Recording... ${recordingSeconds}s / 60s`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: '#dc2626', marginTop: 12 }]}
                  onPress={handleStopVoiceRecording}>
                  <Mic size={20} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>
                    {isUserView
                      ? 'Stop & Apply Voice'
                      : `Stop Recording ${recordingSeconds >= 10 ? '& Clone Voice' : '(min 10s)'}`}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: '#7c3aed' }]}
                onPress={handleStartVoiceRecording}>
                <Mic size={20} color="#ffffff" />
                <Text style={styles.primaryButtonText}>
                  {isUserView ? 'Record & Apply My Voice' : 'Record My Voice'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>Realtime Modern AI Translator</Text>
        <Text style={styles.footerSubtext}>Powered by OpenAI & Advanced TTS</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 150,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  header: {
    marginBottom: 24,
    marginTop: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  userEmail: {
    fontSize: 16,
    color: '#374151',
    marginBottom: 16,
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ef4444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  secondaryButtonText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 8,
  },
  radioGroup: {
    gap: 8,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    marginRight: 12,
  },
  radioRowSelected: {
    backgroundColor: '#eef2ff',
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    gap: 12,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: '#2563eb',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563eb',
  },
  radioLabel: {
    fontSize: 16,
    color: '#374151',
  },
  passwordHint: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 12,
    marginTop: -8,
    lineHeight: 18,
  },
  authError: {
    fontSize: 13,
    color: '#ef4444',
    marginBottom: 10,
    textAlign: 'center',
  },
  voiceDesc: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 1,
  },
  voiceHint: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  linkText: {
    color: '#2563eb',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
  },
  input: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  phoneInput: {
    flex: 1,
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#2563eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    gap: 8,
    marginTop: 20,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  switchDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  voiceStatus: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  voiceStatusText: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
  cloningContainer: {
    alignItems: 'center' as const,
    padding: 20,
    gap: 12,
  },
  cloningText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#2563eb',
  },
  cloningSubtext: {
    fontSize: 14,
    color: '#6b7280',
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
    paddingBottom: 20,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
});
