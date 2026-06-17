import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Keyboard,
  Switch,
  Dimensions,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import { Mic, Square, Users, User } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { LanguagePicker } from '@/components/LanguagePicker';
import {
  realtimeTranslationService,
  TranslationProgress,
} from '@/services/RealtimeTranslationService';
import { audioService } from '@/services/audioService';
import { openaiService } from '@/services/openaiService';
import { ttsService } from '@/services/ttsService';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTENT_MAX_WIDTH = Math.min(SCREEN_WIDTH, 600);

export default function HomeScreen() {
  const { user, settings } = useAuth();

  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('es');
  const [conversationMode, setConversationMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isConversationRunning, setIsConversationRunning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // true while transcribe/translate/TTS runs
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);

  // ── 1. Initialise API keys + sync settings from backend ──
  useEffect(() => {
    const openaiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
    if (openaiKey) {
      openaiService.initialize(openaiKey);
      ttsService.initializeOpenAI(openaiKey);
    }
    const elevenlabsKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY?.trim();
    if (elevenlabsKey) ttsService.initializeElevenLabs(elevenlabsKey);

    if (settings) {
      setSourceLanguage(settings.default_source_language || 'auto');
      setTargetLanguage(settings.default_target_language || 'es');
      setConversationMode(settings.conversation_mode_default ?? false);
    }
  }, [settings]);

  // ── 2. Permissions + AppState (handles Android Home-button backgrounding) ──
  useEffect(() => {
    audioService.requestPermissions().catch(() => {});

    const resetAll = () => {
      realtimeTranslationService.setProgressCallback(null);
      realtimeTranslationService.stopConversation();
      audioService.forceCleanup().catch(() => {});
      setIsRecording(false);
      setIsConversationRunning(false);
      setIsProcessing(false);
      setProgress(null);
    };

    const handleAppState = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        // OS stops the mic on background — reset so we don't show stuck "Listening"
        if (realtimeTranslationService.getIsActive()) {
          resetAll();
        }
      } else if (next === 'active') {
        // App foregrounded — reconcile React state with service truth.
        // isProcessing can get stuck if the pipeline was mid-flight when backgrounded.
        if (!realtimeTranslationService.getIsActive()) {
          setIsRecording(false);
          setIsConversationRunning(false);
          setIsProcessing(false);
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);

    return () => {
      sub.remove();
      realtimeTranslationService.setProgressCallback(null);
      realtimeTranslationService.cleanup().catch(() => {});
    };
  }, []);

  // ── 3. Tab focus/blur (Expo Router tabs never unmount) ──
  useFocusEffect(
    useCallback(() => {
      // ARRIVING at tab: reconcile React state with service truth.
      // If the service stopped (e.g., OS killed the mic on background)
      // but React state still shows "recording", reset to idle.
      if (!realtimeTranslationService.getIsActive()) {
        setIsRecording(false);
        setIsConversationRunning(false);
        setIsProcessing(false);
      }
      realtimeTranslationService.setProgressCallback(setProgress);

      return () => {
        // LEAVING tab: clear callback FIRST (prevents stale update race),
        // then stop any active session.
        realtimeTranslationService.setProgressCallback(null);
        if (realtimeTranslationService.getIsActive()) {
          realtimeTranslationService.stopConversation();
          audioService.forceCleanup().catch(() => {});
          setIsRecording(false);
          setIsConversationRunning(false);
          setIsProcessing(false);
          setProgress(null);
        }
      };
    }, [])
  );

  const handleToggleRecording = async () => {
    if (isButtonDisabled || isProcessing) return;
    setIsButtonDisabled(true);
    Keyboard.dismiss();

    try {
      if (conversationMode) {
        if (isConversationRunning) {
          await handleStopConversation();
        } else {
          handleStartConversation();
        }
      } else {
        if (isRecording) {
          await handleStopRecording();
        } else {
          await handleStartRecording();
        }
      }
    } finally {
      setTimeout(() => setIsButtonDisabled(false), 800);
    }
  };

  // ── Single Translation Mode ──
  const handleStartRecording = async () => {
    setIsRecording(true); // Optimistic: show stop button immediately while audio system starts
    try {
      await realtimeTranslationService.startRealtimeRecording(
        sourceLanguage, targetLanguage,
        settings?.tts_provider || 'device',
        user?.id,
      );
    } catch {
      setIsRecording(false);
      setProgress(null);
      realtimeTranslationService.cleanup().catch(() => {});
    }
  };

  const handleStopRecording = async () => {
    setIsRecording(false);
    setIsProcessing(true); // disable mic button during transcribe→translate→TTS
    try {
      await realtimeTranslationService.stopRealtimeRecording();
    } catch {
      setProgress(null);
      realtimeTranslationService.cleanup().catch(() => {});
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Conversation Mode ──
  const handleStartConversation = () => {
    setIsConversationRunning(true);
    realtimeTranslationService.startConversation(
      sourceLanguage, targetLanguage,
      settings?.tts_provider || 'device',
      user?.id,
    ).then(() => {
      setIsConversationRunning(false);
    }).catch(() => {
      setIsConversationRunning(false);
      setProgress(null);
      realtimeTranslationService.cleanup().catch(() => {});
    });
  };

  const handleStopConversation = async () => {
    realtimeTranslationService.stopConversation();
    setIsConversationRunning(false);
  };

  const getLangName = (code: string) =>
    SUPPORTED_LANGUAGES.find(l => l.code === code)?.name ?? code.toUpperCase();

  const getStatusText = () => {
    if (!progress) return 'Tap the mic to start speaking';
    switch (progress.stage) {
      case 'recording': {
        const from = getLangName(progress.currentSourceLanguage || sourceLanguage);
        const to   = getLangName(progress.currentTargetLanguage || targetLanguage);
        return conversationMode
          ? `Person ${progress.currentPerson}: Listening… (${from} → ${to})`
          : `Listening… (${from} → ${to})`;
      }
      case 'transcribing':      return 'Transcribing speech…';
      case 'translating':       return 'Translating…';
      case 'generating_speech': return 'Generating speech…';
      case 'playing':           return 'Playing translation…';
      case 'waiting':
        return conversationMode
          ? `Ready for Person ${progress.currentPerson === 'A' ? 'B' : 'A'}…`
          : 'Processing…';
      case 'complete':
        return conversationMode && isConversationRunning
          ? 'Turn complete'
          : 'Translation complete ✓';
      case 'error':
        return `Error: ${progress.error}`;
      default:
        return String(progress.stage).replace(/_/g, ' ');
    }
  };

  const isActive = isRecording || isConversationRunning;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.title}>AI Translator</Text>
          <Text style={styles.subtitle}>Real-time voice translation</Text>
        </View>

        {/* ── Language Pickers ── */}
        <View style={styles.card}>
          <View style={styles.pickerSection}>
            <LanguagePicker
              label="Source Language"
              selectedLanguage={sourceLanguage}
              onSelectLanguage={setSourceLanguage}
              allowAuto
              disabled={isActive}
            />
            <View style={styles.pickerDivider} />
            <LanguagePicker
              label="Target Language"
              selectedLanguage={targetLanguage}
              onSelectLanguage={setTargetLanguage}
              excludeLanguage="auto"
              disabled={isActive}
            />
          </View>
        </View>

        {/* ── Mode Toggle ── */}
        <View style={[styles.card, styles.modeCard, conversationMode && styles.modeCardActive]}>
          <View style={styles.modeLeft}>
            {conversationMode
              ? <Users color="#2563eb" size={24} />
              : <User  color="#6b7280" size={24} />}
            <View style={styles.modeText}>
              <Text style={styles.modeTitle}>
                {conversationMode ? 'Conversation Mode' : 'Single Translation'}
              </Text>
              <Text style={styles.modeSub}>
                {conversationMode
                  ? 'Auto-detects silence, swaps speakers'
                  : 'One-time translation only'}
              </Text>
            </View>
          </View>
          <Switch
            value={conversationMode}
            onValueChange={setConversationMode}
            disabled={isActive}
            trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            thumbColor={conversationMode ? '#2563eb' : '#f3f4f6'}
          />
        </View>

        {/* ── Conversation hint ── */}
        {conversationMode && !isConversationRunning && (
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>
              Tap the mic to start. Each person gets 10 s to speak. Tap stop to end.
            </Text>
          </View>
        )}

        {/* ── Mic Button ── */}
        <View style={styles.micSection}>
          <TouchableOpacity
            style={[
              styles.micButton,
              isActive      && styles.micButtonActive,
              isProcessing  && styles.micButtonProcessing,
            ]}
            onPress={handleToggleRecording}
            disabled={isButtonDisabled || isProcessing}
            activeOpacity={0.8}
          >
            {isActive
              ? <Square color="white" size={36} fill="white" />
              : <Mic    color="white" size={36} />}
          </TouchableOpacity>
          <Text style={[
            styles.statusText,
            {
              color: isActive || isProcessing
                ? '#ef4444'
                : progress?.stage === 'error'
                ? '#dc2626'
                : progress?.stage === 'complete'
                ? '#16a34a'
                : '#6b7280',
            },
          ]}>
            {getStatusText()}
          </Text>
        </View>

        {/* ── Results ── */}
        {progress && (progress.sourceText || progress.translatedText) && (
          <View style={styles.results}>
            {conversationMode && progress.currentPerson && (
              <View style={styles.personBadge}>
                <Text style={styles.personBadgeText}>Person {progress.currentPerson}</Text>
                <Text style={styles.personBadgeSub}>
                  {getLangName(progress.currentSourceLanguage || sourceLanguage)} →{' '}
                  {getLangName(progress.currentTargetLanguage || targetLanguage)}
                </Text>
              </View>
            )}

            {progress.sourceText && (
              <View style={styles.textBox}>
                <Text style={styles.textBoxLabel}>
                  {getLangName(progress.currentSourceLanguage || sourceLanguage)}
                </Text>
                <Text style={styles.textBoxContent}>{progress.sourceText}</Text>
              </View>
            )}

            {progress.translatedText && (
              <View style={[styles.textBox, styles.translatedBox]}>
                <Text style={styles.textBoxLabel}>
                  Translation → {getLangName(progress.currentTargetLanguage || targetLanguage)}
                </Text>
                <Text style={styles.textBoxContent}>{progress.translatedText}</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1e3a5f',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#64748b',
    marginTop: 4,
  },
  card: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
    overflow: 'visible',
  },
  pickerSection: {
    padding: 4,
    zIndex: 5000,
  },
  pickerDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginHorizontal: 12,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  modeCardActive: {
    borderColor: '#93c5fd',
    backgroundColor: '#f0f7ff',
  },
  modeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  modeText: {
    marginLeft: 12,
    flex: 1,
  },
  modeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 2,
  },
  modeSub: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
  hintBox: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#2563eb',
  },
  hintText: {
    fontSize: 13,
    color: '#1e40af',
    fontWeight: '500',
    lineHeight: 18,
  },
  micSection: {
    alignItems: 'center',
    marginVertical: 20,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
  },
  micButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  micButtonActive: {
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
  },
  micButtonProcessing: {
    backgroundColor: '#f97316', // orange = busy processing
    shadowColor: '#f97316',
    opacity: 0.85,
  },
  statusText: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  results: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
  },
  personBadge: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  personBadgeText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  personBadgeSub: {
    fontSize: 12,
    color: '#dbeafe',
    marginTop: 2,
  },
  textBox: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 3,
    borderLeftWidth: 4,
    borderLeftColor: '#94a3b8',
  },
  translatedBox: {
    borderLeftColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  textBoxLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  textBoxContent: {
    fontSize: 17,
    color: '#1e293b',
    lineHeight: 26,
  },
});
