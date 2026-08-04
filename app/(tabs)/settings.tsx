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
  Platform,
} from 'react-native';
import { LogOut, Save, Mic, Trash2, Bug } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { audioService } from '@/services/audioService';
import { ttsService, TTSService } from '@/services/ttsService';
import { logger } from '@/lib/logger';

export default function SettingsScreen() {
  // AuthGate (app/_layout.tsx) guarantees `user` is non-null by the time any
  // screen renders — sign-in/sign-up/OTP/password-reset UI lives there now,
  // not here.
  const { user, settings, signOut, updateSettings, viewMode, setViewMode } = useAuth();
  const isUserView = user?.role === 'USER' || viewMode === 'user';

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
  const handleShareDiagnostics = async () => {
    const buildSha = process.env.EXPO_PUBLIC_BUILD_SHA ? process.env.EXPO_PUBLIC_BUILD_SHA.substring(0, 7) : 'dev';
    const header = `Realtime AI Translator diagnostics\nBuild: ${buildSha}  Platform: ${Platform.OS} ${Platform.Version}\nGenerated: ${new Date().toISOString()}\n${'-'.repeat(40)}\n`;
    const body = header + logger.formatRecentEntries();
    try {
      await Share.share({ message: body });
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

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Diagnostics</Text>
            <Text style={styles.sectionDescription}>
              If a translation or conversation-mode issue happens, share this log right after —
              it captures what actually happened on this device (stage-by-stage), which is far more
              useful than a description of the symptom.
            </Text>
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: '#d1d5db' }]}
              onPress={handleShareDiagnostics}>
              <Bug size={18} color="#374151" />
              <Text style={[styles.secondaryButtonText, { color: '#374151' }]}>Share Diagnostics</Text>
            </TouchableOpacity>
          </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Realtime Modern AI Translator</Text>
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
    backgroundColor: '#f9fafb',
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
