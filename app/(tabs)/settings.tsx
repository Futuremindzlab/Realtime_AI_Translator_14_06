import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  Share,
  Linking,
  Platform,
} from 'react-native';
import { LogOut, Save, Mic, Trash2, Bug, Zap } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { audioService } from '@/services/audioService';
import { ttsService, TTSService } from '@/services/ttsService';
import { subscribeToPlan, cancelSubscription as cancelRazorpaySubscription, CheckoutCancelledError } from '@/services/billingService';
import { SubscriptionPlan } from '@/types';
import { logger } from '@/lib/logger';
import { PLAN_INFO, PAID_PLAN_PRICE } from '@/lib/plans';
import { canvasTheme as t } from '@/lib/canvasTheme';

// Customer-facing (isUserView) voice picker: exactly 4 curated OpenAI voices —
// 2 female/2 male, 1 Indian-script-tuned + 1 global each — pulled from the
// existing 6-voice OPENAI_VOICES list rather than duplicating voice data.
// Owners keep the full provider/voice picker below unchanged; this is
// additive, shown only on the isUserView branch.
const CURATED_VOICES = TTSService.OPENAI_VOICES.filter(v =>
  ['nova', 'shimmer', 'echo', 'onyx'].includes(v.id)
);

export default function SettingsScreen() {
  // AuthGate (app/_layout.tsx) guarantees `user` is non-null by the time any
  // screen renders — sign-in/sign-up/OTP/password-reset UI lives there now,
  // not here.
  const { user, settings, signOut, deleteAccount, updateSettings, refreshSettings } = useAuth();
  const [deletingAccount, setDeletingAccount] = useState(false);
  // Real OWNER vs. regular-customer distinction (Cognito role) — no more
  // same-account preview toggle; an owner wanting the regular-customer
  // experience signs in as one of the dedicated regular accounts instead.
  const isUserView = user?.role === 'USER';
  const currentPlan: SubscriptionPlan = settings?.plan || 'basic';
  const [subscribingPlan, setSubscribingPlan] = useState<'plus' | 'live' | null>(null);
  const [cancellingSubscription, setCancellingSubscription] = useState(false);

  const [ttsProvider, setTtsProvider] = useState<'elevenlabs' | 'openai' | 'device' | 'azure'>('device');
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('female');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [conversationModeDefault, setConversationModeDefault] = useState(true);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isCloningVoice, setIsCloningVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Guard against the countdown interval outliving the component (e.g. user
  // navigates away mid-recording) — it would otherwise keep firing setState on
  // an unmounted screen and could trigger stopRecording() at an unexpected time.
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    };
  }, []);

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

  const handleSignOut = async () => {
    try {
      await signOut();
      Alert.alert('Success', 'Signed out successfully');
    } catch {
      Alert.alert('Error', 'Failed to sign out');
    }
  };

  // Real purchase flow — see services/billingService.ts.
  const handleSubscribe = async (plan: 'plus' | 'live') => {
    if (subscribingPlan || plan === currentPlan) return;
    setSubscribingPlan(plan);
    try {
      await subscribeToPlan(plan);
      await refreshSettings();
      Alert.alert('Subscribed!', `You're now on the ${PLAN_INFO[plan].label} plan.`);
    } catch (error) {
      if (error instanceof CheckoutCancelledError) {
        // User backed out of Checkout — not an error worth alerting about.
        return;
      }
      console.error('Subscribe error:', error);
      Alert.alert('Payment failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubscribingPlan(null);
    }
  };

  const handleCancelSubscription = () => {
    Alert.alert(
      'Cancel subscription?',
      `You'll keep ${PLAN_INFO[currentPlan].label} access until the end of your current billing cycle, then move to Basic.`,
      [
        { text: 'Keep subscription', style: 'cancel' },
        {
          text: 'Cancel subscription',
          style: 'destructive',
          onPress: async () => {
            setCancellingSubscription(true);
            try {
              await cancelRazorpaySubscription();
              await refreshSettings();
              Alert.alert('Cancelled', "You'll move to Basic at the end of your current billing cycle.");
            } catch (error) {
              console.error('Cancel subscription error:', error);
              Alert.alert('Error', 'Failed to cancel subscription. Please try again.');
            } finally {
              setCancellingSubscription(false);
            }
          },
        },
      ]
    );
  };

  // Irreversible — double-confirmed given what it actually does (cancels any
  // active subscription immediately, permanently deletes translation history
  // and audio, then deletes the account itself). See
  // backend/src/handlers/account.mjs for the exact order of operations.
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, translation history, and cancels any active subscription immediately. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'There is no way to recover your account or data after this.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete my account',
                  style: 'destructive',
                  onPress: async () => {
                    setDeletingAccount(true);
                    try {
                      await deleteAccount();
                      // No success alert — deleteAccount() already signs out,
                      // which unmounts this screen behind AuthGate's sign-in view.
                    } catch (error) {
                      console.error('Delete account error:', error);
                      Alert.alert('Error', 'Failed to delete account. Please try again.');
                      setDeletingAccount(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
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
        // isUserView customers now pick from the 4-voice curated OpenAI
        // picker above, not a provider list — pin their account to 'openai'
        // so that choice is what actually plays, rather than silently
        // leaving whatever provider was on the account before (which used
        // to be the effect of omitting tts_provider here entirely). Owners
        // keep full control via their own provider picker, unchanged.
        tts_provider: isUserView ? 'openai' : ttsProvider,
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
      recordingIntervalRef.current = setInterval(() => {
        setRecordingSeconds(prev => {
          if (prev >= maxSeconds) {
            if (recordingIntervalRef.current) {
              clearInterval(recordingIntervalRef.current);
              recordingIntervalRef.current = null;
            }
            handleStopVoiceRecording();
            return maxSeconds + 1;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setIsRecordingVoice(false);
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const handleStopVoiceRecording = async () => {
    try {
      // Clear the timer
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
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

  // There's no way to pull `adb logcat` off a user's real device — this is the
  // only practical way to see what actually happened on-device (which stage of
  // a conversation turn ran, what error was thrown, network vs. non-network)
  // instead of guessing from a secondhand description of the symptom.
  //
  // Opens the device's mail app pre-addressed to support, subject + diagnostic
  // log already filled in, so a user reporting a problem doesn't have to type
  // the address themselves or explain what went wrong from memory. mailto:
  // URLs have no universal length ceiling, but some mail clients truncate or
  // reject very long ones — cap the log body defensively rather than find out
  // in the field. Falls back to the plain OS share sheet if no mail app can
  // handle mailto: at all (e.g. a device with no email account configured).
  const SUPPORT_EMAIL = 'Admin@futuremindzlab.com';
  const MAILTO_BODY_MAX_CHARS = 1500;

  const handleShareDiagnostics = async () => {
    const buildSha = process.env.EXPO_PUBLIC_BUILD_SHA ? process.env.EXPO_PUBLIC_BUILD_SHA.substring(0, 7) : 'dev';
    const header = `OneLingo diagnostics\nBuild: ${buildSha}  Platform: ${Platform.OS} ${Platform.Version}\nGenerated: ${new Date().toISOString()}\n${'-'.repeat(40)}\n`;
    const log = logger.formatRecentEntries();
    const body = header + log;

    const mailBody = body.length > MAILTO_BODY_MAX_CHARS
      ? `${body.slice(0, MAILTO_BODY_MAX_CHARS)}\n…(truncated — full log available via Share if needed)`
      : body;
    const subject = `OneLingo support — diagnostics (${buildSha})`;
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`;

    try {
      const canOpenMail = await Linking.canOpenURL(mailtoUrl);
      if (canOpenMail) {
        await Linking.openURL(mailtoUrl);
        return;
      }
    } catch {
      // fall through to the generic share sheet below
    }

    try {
      await Share.share({ message: `To: ${SUPPORT_EMAIL}\nSubject: ${subject}\n\n${body}` });
    } catch {
      Alert.alert('Error', 'Failed to share diagnostics');
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

  // AuthGate never mounts this screen without a signed-in user; this is just
  // enough for TypeScript to narrow `user` below, not a reachable runtime path.
  if (!user) return null;

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

      <View style={styles.card}>
            <Text style={styles.sectionTitle}>Account</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleSignOut}>
              <LogOut size={20} color={t.danger} />
              <Text style={styles.secondaryButtonText}>Sign Out</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 12 }]}
              disabled={deletingAccount}
              onPress={handleDeleteAccount}>
              {deletingAccount ? (
                <ActivityIndicator size="small" color={t.danger} />
              ) : (
                <>
                  <Trash2 size={20} color={t.danger} />
                  <Text style={styles.secondaryButtonText}>Delete Account</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Your Plan</Text>
            <View style={styles.planBadgeRow}>
              <View style={styles.planBadge}>
                <Zap size={14} color={t.personB} />
                <Text style={styles.planBadgeText}>{PLAN_INFO[currentPlan].label}</Text>
              </View>
            </View>
            <Text style={styles.sectionDescription}>{PLAN_INFO[currentPlan].description}</Text>

            {currentPlan === 'basic' ? (
              // Real purchase flow — Razorpay recurring subscription checkout.
              (['plus', 'live'] as const).map((plan) => (
                <TouchableOpacity
                  key={plan}
                  style={[styles.secondaryButton, styles.upgradeButton]}
                  disabled={subscribingPlan !== null}
                  onPress={() => handleSubscribe(plan)}>
                  {subscribingPlan === plan ? (
                    <ActivityIndicator size="small" color={t.personB} />
                  ) : (
                    <>
                      <Zap size={18} color={t.personB} />
                      <Text style={[styles.secondaryButtonText, { color: t.personB }]}>
                        Upgrade to {PLAN_INFO[plan].label} — {PAID_PLAN_PRICE[plan]}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ))
            ) : settings?.razorpay_subscription_id ? (
              settings.razorpay_subscription_status === 'cancel_requested' ? (
                <Text style={styles.sectionDescription}>
                  Cancellation scheduled — you&apos;ll move to Basic at the end of your current billing cycle.
                </Text>
              ) : (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  disabled={cancellingSubscription}
                  onPress={handleCancelSubscription}>
                  {cancellingSubscription ? (
                    <ActivityIndicator size="small" color={t.danger} />
                  ) : (
                    <Text style={[styles.secondaryButtonText, { color: t.danger }]}>Cancel Subscription</Text>
                  )}
                </TouchableOpacity>
              )
            ) : null}
          </View>

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
            {isUserView ? (
              // Customer-facing simplified picker: exactly 4 curated OpenAI
              // voices (2 male/2 female, 1 Indian-script-tuned + 1 global
              // each) instead of exposing the provider/per-provider voice
              // lists below (owner-only, unchanged). Selecting one pins this
              // account to the OpenAI engine — the only provider change made
              // on the isUserView path — so the choice actually takes effect;
              // the owner-only provider/voice picker in the else-branch below
              // (and everything it drives in ttsService.ts) is untouched.
              <View style={styles.radioGroup}>
                {CURATED_VOICES.map(v => (
                  <TouchableOpacity
                    key={v.id}
                    style={styles.radioOption}
                    onPress={() => {
                      setTtsProvider('openai');
                      setSelectedVoiceId(v.id);
                      setVoiceGender(v.gender === 'male' ? 'male' : 'female');
                    }}>
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
            ) : (
              <>
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
              </>
            )}

            <View style={styles.switchRow}>
              <View>
                <Text style={styles.switchLabel}>Auto Conversation Mode</Text>
                <Text style={styles.switchDescription}>Start in conversation mode by default</Text>
              </View>
              <Switch
                value={conversationModeDefault}
                onValueChange={setConversationModeDefault}
                trackColor={{ false: t.cardBorderStrong, true: t.personBBorder }}
                thumbColor={conversationModeDefault ? t.personB : t.textFaint}
              />
            </View>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSaveSettings}>
              <Save size={20} color={t.bg} />
              <Text style={styles.saveButtonText}>Save Preferences</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Voice Cloning</Text>
            <Text style={styles.sectionDescription}>
              {currentPlan !== 'live'
                ? 'Available on the Live plan — hear translations spoken in your own voice.'
                : isUserView
                ? 'Record your voice to personalize translations.'
                : 'Clone your voice so translations sound like you. Record 30-60 seconds of clear speech. Works with ElevenLabs TTS.'}
            </Text>

            {currentPlan !== 'live' && !settings?.custom_voice_id ? (
              <TouchableOpacity
                style={[styles.secondaryButton, styles.upgradeButton]}
                disabled={subscribingPlan !== null}
                onPress={() => handleSubscribe('live')}>
                {subscribingPlan === 'live' ? (
                  <ActivityIndicator size="small" color={t.personB} />
                ) : (
                  <>
                    <Zap size={18} color={t.personB} />
                    <Text style={[styles.secondaryButtonText, { color: t.personB }]}>
                      Upgrade to {PLAN_INFO.live.label} — {PAID_PLAN_PRICE.live}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : settings?.custom_voice_id ? (
              <View>
                <View style={[styles.voiceStatus, { backgroundColor: t.personBBg }]}>
                  <Text style={[styles.voiceStatusText, { color: t.success }]}>
                    {isUserView ? 'Custom voice active ✓' : 'Custom voice active'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.secondaryButton, { marginTop: 12 }]}
                  onPress={handleRemoveCustomVoice}>
                  <Trash2 size={18} color={t.danger} />
                  <Text style={styles.secondaryButtonText}>
                    {isUserView ? 'Reset to Default Voice' : 'Remove Custom Voice'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : isCloningVoice ? (
              <View style={styles.cloningContainer}>
                <ActivityIndicator size="large" color={t.personB} />
                <Text style={styles.cloningText}>
                  {isUserView ? 'Applying your voice...' : 'Cloning your voice...'}
                </Text>
                <Text style={styles.cloningSubtext}>This may take 15-30 seconds</Text>
              </View>
            ) : isRecordingVoice ? (
              <View>
                <View style={[styles.voiceStatus, { backgroundColor: 'rgba(252,165,165,0.14)' }]}>
                  <Text style={[styles.voiceStatusText, { color: t.danger }]}>
                    {isUserView
                      ? `Recording... ${recordingSeconds}s`
                      : `Recording... ${recordingSeconds}s / 60s`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: t.recordGradient[0], marginTop: 12 }]}
                  onPress={handleStopVoiceRecording}>
                  <Mic size={20} color={t.text} />
                  <Text style={styles.primaryButtonText}>
                    {isUserView
                      ? 'Stop & Apply Voice'
                      : `Stop Recording ${recordingSeconds >= 10 ? '& Clone Voice' : '(min 10s)'}`}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: t.personA }]}
                onPress={handleStartVoiceRecording}>
                <Mic size={20} color={t.text} />
                <Text style={styles.primaryButtonText}>
                  {isUserView ? 'Record & Apply My Voice' : 'Record My Voice'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Diagnostics</Text>
            <Text style={styles.sectionDescription}>
              If a translation or conversation-mode issue happens, share this log right after —
              it captures what actually happened on this device (stage-by-stage), which is far more
              useful than a description of the symptom.
            </Text>
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: t.cardBorderStrong }]}
              onPress={handleShareDiagnostics}>
              <Bug size={18} color={t.textMuted} />
              <Text style={[styles.secondaryButtonText, { color: t.textMuted }]}>Share Diagnostics</Text>
            </TouchableOpacity>
          </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>OneLingo</Text>
        <Text style={styles.footerSubtext}>Powered by OpenAI & Advanced TTS</Text>
        {/* versionCode/versionName never change between builds — this is the only
            way to tell whether an installed APK is actually the latest build. */}
        <Text style={styles.footerSubtext}>
          Build {process.env.EXPO_PUBLIC_BUILD_SHA ? process.env.EXPO_PUBLIC_BUILD_SHA.substring(0, 7) : 'dev'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 150,
  },
  header: {
    marginBottom: 24,
    marginTop: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: t.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: t.textMuted,
  },
  card: {
    backgroundColor: t.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: t.text,
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: t.textMuted,
    marginBottom: 16,
  },
  userEmail: {
    fontSize: 16,
    color: t.textMuted,
    marginBottom: 16,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: t.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  secondaryButtonText: {
    color: t.danger,
    fontSize: 16,
    fontWeight: '600',
  },
  planBadgeRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.personBBg,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  planBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: t.personB,
  },
  upgradeButton: {
    borderColor: t.personBBorder,
    marginTop: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: t.textMuted,
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
    backgroundColor: t.personBBg,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: t.bgElevated,
    borderRadius: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: t.cardBorderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: t.personB,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.personB,
  },
  radioLabel: {
    fontSize: 16,
    color: t.text,
  },
  voiceDesc: {
    fontSize: 12,
    color: t.textFaint,
    marginTop: 1,
  },
  voiceHint: {
    fontSize: 13,
    color: t.textMuted,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  primaryButton: {
    backgroundColor: t.personB,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  primaryButtonText: {
    color: t.text,
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: t.personB,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    gap: 8,
    marginTop: 20,
  },
  saveButtonText: {
    color: t.bg,
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
    color: t.text,
  },
  switchDescription: {
    fontSize: 14,
    color: t.textMuted,
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
    color: t.personB,
  },
  cloningSubtext: {
    fontSize: 14,
    color: t.textMuted,
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
    paddingBottom: 20,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.textMuted,
  },
  footerSubtext: {
    fontSize: 12,
    color: t.textFaint,
    marginTop: 4,
  },
});
