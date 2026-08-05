import React, { useState, useEffect, useRef } from 'react';
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
import { useAuth } from '@/contexts/AuthContext';
import { LanguagePicker } from '@/components/LanguagePicker';
import {
  realtimeTranslationService,
  TranslationProgress,
} from '@/services/RealtimeTranslationService';
import { audioService } from '@/services/audioService';
import { ttsService } from '@/services/ttsService';
import { whisperService } from '@/services/whisperService';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';
import { logger } from '@/lib/logger';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTENT_MAX_WIDTH = Math.min(SCREEN_WIDTH, 600);

export default function HomeScreen() {
  const { user, settings } = useAuth();

  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('es');
  const [conversationMode, setConversationMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isConversationRunning, setIsConversationRunning] = useState(false);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);
  const backgroundDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 1. Startup voices + sync settings ──
  // Provider API keys live server-side (backend AI proxy) — nothing to initialise here.
  useEffect(() => {
    if (!settings) {
      // Cold start: force 3 startup voice defaults before user settings arrive
      // Indian Female=Aria, Indian Male=George, Foreign=Aria/George (auto-routed)
      ttsService.initializeStartupVoices();
    } else {
      setSourceLanguage(settings.default_source_language || 'auto');
      setTargetLanguage(settings.default_target_language || 'es');
      setConversationMode(settings.conversation_mode_default ?? false);
    }
  }, [settings]);

  // ── 2. Progress callback + permissions + AppState ──
  useEffect(() => {
    // Always keep the progress callback active (February pattern — never clears on tab change)
    realtimeTranslationService.setProgressCallback(setProgress);
    audioService.requestPermissions().catch(() => {});
    // Preload on-device Whisper in the background so non-Indic/RTL transcriptions
    // skip the cloud round trip once the (cached-after-first-run) model is ready.
    // transcribeWithFallback() already falls back to cloud if this hasn't resolved yet.
    whisperService.initialize().catch(() => {});

    const handleAppState = (next: AppStateStatus) => {
      // Diagnostic: captured in Settings -> Share Diagnostics. Reported bug was
      // "Person A: Listening…" appearing then disappearing instantly on Android
      // with no other error — a spurious 'background' transition right as
      // recording starts (audio-focus negotiation, OEM overlay, the mic-privacy
      // indicator, etc. can all momentarily pull focus on some Android builds)
      // would immediately tear the whole conversation down via the branch below
      // and look exactly like that. This log will confirm or rule that out.
      logger.info('AppState changed', { next, wasConversationActive: realtimeTranslationService.getIsActive() });

      if (next === 'background') {
        // True background: OS kills mic access — must stop everything.
        // NOTE: 'inactive' is intentionally excluded — on iOS it fires for
        // notification overlays, permission dialogs, and control center
        // (mic is NOT killed). Stopping on 'inactive' would drop conversations
        // at startup (permission dialog) or on any incoming notification.
        //
        // Debounced: a genuine backgrounding (home button, app switch) persists;
        // starting an audio recording can momentarily trigger a transient
        // 'background' blip on some Android devices that does not. Re-confirm
        // AppState is still 'background' after a short delay before actually
        // tearing the conversation down, instead of reacting to the very first
        // event — Android's own mic-access revocation on a real backgrounding
        // is unaffected by this, so a genuine background is still handled
        // correctly, just ~600ms later.
        if (backgroundDebounceRef.current) clearTimeout(backgroundDebounceRef.current);
        backgroundDebounceRef.current = setTimeout(() => {
          backgroundDebounceRef.current = null;
          if (AppState.currentState !== 'background') {
            logger.info('AppState background was transient — ignoring', { currentState: AppState.currentState });
            return;
          }
          if (realtimeTranslationService.getIsActive()) {
            logger.warn('AppState confirmed background — stopping conversation', {});
            realtimeTranslationService.stopConversation();
            audioService.forceCleanup().catch(() => {});
            setIsRecording(false);
            setIsConversationRunning(false);
            setProgress(null);
          }
        }, 600);
      } else if (next === 'active') {
        // Cancel a pending debounce from a background blip that already recovered.
        if (backgroundDebounceRef.current) {
          clearTimeout(backgroundDebounceRef.current);
          backgroundDebounceRef.current = null;
        }
        // App came back to foreground — re-attach callback and reconcile state
        realtimeTranslationService.setProgressCallback(setProgress);
        if (!realtimeTranslationService.getIsActive()) {
          setIsRecording(false);
          setIsConversationRunning(false);
          setIsButtonDisabled(false);
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);

    return () => {
      sub.remove();
      if (backgroundDebounceRef.current) clearTimeout(backgroundDebounceRef.current);
      // Feb pattern: do NOT clear the progress callback on unmount so any in-flight
      // progress from a final cleanup cycle is still routed correctly.
      realtimeTranslationService.cleanup().catch(() => {});
    };
  }, []);

  // ── Button handler ──
  const handleToggleRecording = async () => {
    if (isButtonDisabled) return;
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
    try {
      await realtimeTranslationService.startRealtimeRecording(
        sourceLanguage,
        targetLanguage,
        settings?.tts_provider || 'device',
        user?.id,
      );
      setIsRecording(true); // Set AFTER success so a failed start shows the error, not a red button
    } catch (error: any) {
      setIsRecording(false);
      // Show error in status text so user knows what went wrong
      setProgress({
        stage: 'error',
        error: error?.message || 'Could not start recording — check microphone permission',
      });
      await realtimeTranslationService.forceReset();
    }
  };

  const handleStopRecording = async () => {
    setIsRecording(false);
    try {
      await realtimeTranslationService.stopRealtimeRecording();
    } catch {
      await realtimeTranslationService.forceReset();
    }
  };

  // ── Conversation Mode ──
  const handleStartConversation = () => {
    setIsConversationRunning(true);
    realtimeTranslationService
      .startConversation(
        sourceLanguage,
        targetLanguage,
        settings?.tts_provider || 'device',
        user?.id,
      )
      .then(() => {
        setIsConversationRunning(false);
      })
      .catch(async () => {
        setIsConversationRunning(false);
        await realtimeTranslationService.forceReset();
      });
  };

  const handleStopConversation = async () => {
    realtimeTranslationService.stopConversation();
    setIsConversationRunning(false);
  };

  // Feature: immediate-stop control (Person B handover). Ends the current
  // speaker's turn right now instead of waiting for the silence timeout to elapse.
  const handleInterruptTurn = () => {
    realtimeTranslationService.interruptCurrentTurn();
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
        // currentPerson is already the upcoming speaker by this point — the
        // service flips isPersonATurn *before* emitting the 'waiting' update,
        // so inverting it here (as this used to do) showed the person who had
        // just finished instead of the one about to speak next.
        return conversationMode
          ? `Ready for Person ${progress.currentPerson}…`
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
            style={[styles.micButton, isActive && styles.micButtonActive]}
            onPress={handleToggleRecording}
            disabled={isButtonDisabled}
            activeOpacity={0.8}
          >
            {isActive
              ? <Square color="white" size={36} fill="white" />
              : <Mic    color="white" size={36} />}
          </TouchableOpacity>
          <Text style={[
            styles.statusText,
            {
              color: isActive
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

        {/* Feature: immediate-stop control — ends the current speaker's turn right
            now instead of waiting out the silence timeout. Only shown mid-recording
            in conversation mode, where waiting for the timeout is otherwise the only option. */}
        {conversationMode && isConversationRunning && progress?.stage === 'recording' && (
          <TouchableOpacity style={styles.interruptButton} onPress={handleInterruptTurn}>
            <Text style={styles.interruptButtonText}>Done talking — pass to next person</Text>
          </TouchableOpacity>
        )}

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
  interruptButton: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  interruptButtonText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '600',
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
