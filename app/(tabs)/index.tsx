import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Keyboard,
  Dimensions,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Mic, Square, Users, User, Settings as SettingsIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { LanguagePairControl } from '@/components/conversation/LanguagePairControl';
import { SplitFaceToFace } from '@/components/conversation/SplitFaceToFace';
import { ChatTranscript, TranscriptTurn } from '@/components/conversation/ChatTranscript';
import {
  realtimeTranslationService,
  TranslationProgress,
} from '@/services/RealtimeTranslationService';
import { audioService } from '@/services/audioService';
import { ttsService } from '@/services/ttsService';
import { whisperService } from '@/services/whisperService';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { canvasTheme as t } from '@/lib/canvasTheme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTENT_MAX_WIDTH = Math.min(SCREEN_WIDTH, 600);

// Progress stages at/after which both sourceText and translatedText are final —
// safe points to append the turn to the session transcript.
const TRANSCRIPT_TRIGGER_STAGES = new Set<TranslationProgress['stage']>([
  'generating_speech', 'playing', 'complete', 'waiting',
]);

export default function HomeScreen() {
  const { user, settings } = useAuth();
  const router = useRouter();

  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('es');
  const [conversationMode, setConversationMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isConversationRunning, setIsConversationRunning] = useState(false);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const backgroundDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRecordedKeyRef = useRef<string | null>(null);

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

  const getLangName = (code: string) =>
    SUPPORTED_LANGUAGES.find(l => l.code === code)?.name ?? (code ? code.toUpperCase() : '—');

  // ── 3. Append completed turns to the session transcript ──
  useEffect(() => {
    if (!progress || !progress.sourceText || !progress.translatedText) return;
    if (!progress.stage || !TRANSCRIPT_TRIGGER_STAGES.has(progress.stage)) return;

    const key = `${progress.currentPerson || 'A'}|${progress.sourceText}|${progress.translatedText}`;
    if (key === lastRecordedKeyRef.current) return;
    lastRecordedKeyRef.current = key;

    const srcCode = progress.currentSourceLanguage || sourceLanguage;
    const tgtCode = progress.currentTargetLanguage || targetLanguage;

    setTurns(prev => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        person: progress.currentPerson || 'A',
        sourceText: progress.sourceText!,
        translatedText: progress.translatedText!,
        sourceLangName: getLangName(srcCode),
        targetLangName: getLangName(tgtCode),
        targetLangCode: tgtCode,
      },
      ...prev,
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

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

  const handleReplay = async (turn: TranscriptTurn) => {
    if (isActive || replayingId) return;
    setReplayingId(turn.id);
    try {
      const uri = await ttsService.generateSpeech(
        turn.translatedText, turn.targetLangCode, settings?.tts_provider || 'device',
      );
      await audioService.forceCleanup();
      if (uri) await audioService.playAudio(uri);
    } catch (error) {
      logger.error('Transcript replay failed', error, { platform: Platform.OS });
    } finally {
      setReplayingId(null);
    }
  };

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
  const showCanvas = conversationMode && isConversationRunning;

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
          <View>
            <Text style={styles.title}>The OneLingo</Text>
            <Text style={styles.subtitle}>Real-time voice translation</Text>
          </View>
          <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/settings')}>
            <SettingsIcon color={t.text} size={18} />
          </TouchableOpacity>
        </View>

        {/* ── Language Pair ── */}
        <View style={styles.section}>
          <LanguagePairControl
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            onSelectSource={setSourceLanguage}
            onSelectTarget={setTargetLanguage}
            onSwap={() => {
              setSourceLanguage(targetLanguage === 'auto' ? sourceLanguage : targetLanguage);
              setTargetLanguage(sourceLanguage === 'auto' ? targetLanguage : sourceLanguage);
            }}
            disabled={isActive}
          />
        </View>

        {/* ── Mode Toggle ── */}
        <View style={[styles.section, styles.seg]}>
          <TouchableOpacity
            style={[styles.segItem, !conversationMode && styles.segItemOn]}
            onPress={() => !isActive && setConversationMode(false)}
            disabled={isActive}
          >
            <User size={15} color={!conversationMode ? t.personB : t.textMuted} />
            <Text style={[styles.segText, !conversationMode && styles.segTextOn]}>Single</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segItem, conversationMode && styles.segItemOn]}
            onPress={() => !isActive && setConversationMode(true)}
            disabled={isActive}
          >
            <Users size={15} color={conversationMode ? t.personB : t.textMuted} />
            <Text style={[styles.segText, conversationMode && styles.segTextOn]}>Conversation</Text>
          </TouchableOpacity>
        </View>

        {/* ── Conversation hint ── */}
        {conversationMode && !isConversationRunning && (
          <View style={[styles.section, styles.hintBox]}>
            <Text style={styles.hintText}>
              Tap the mic to start. Each person gets 10s to speak — the phone lies flat between you
              and the other side reads their translation right-side up.
            </Text>
          </View>
        )}

        {/* ── Primary control: face-to-face canvas while a conversation is live, otherwise the idle/solo mic ── */}
        {showCanvas ? (
          <View style={styles.section}>
            <SplitFaceToFace
              progress={progress}
              isActive={isActive}
              disabled={isButtonDisabled}
              onTogglePress={handleToggleRecording}
              getLangName={getLangName}
            />
          </View>
        ) : (
          <View style={styles.micSection}>
            <TouchableOpacity
              style={[styles.micButton, isActive && styles.micButtonActive]}
              onPress={handleToggleRecording}
              disabled={isButtonDisabled}
              activeOpacity={0.85}
            >
              {isActive
                ? <Square color="white" size={34} fill="white" />
                : <Mic    color="white" size={34} />}
            </TouchableOpacity>
            <Text style={[
              styles.statusText,
              {
                color: isActive
                  ? '#fca5a5'
                  : progress?.stage === 'error'
                  ? '#fca5a5'
                  : progress?.stage === 'complete'
                  ? t.success
                  : t.textMuted,
              },
            ]}>
              {getStatusText()}
            </Text>
          </View>
        )}

        {/* Feature: immediate-stop control — ends the current speaker's turn right
            now instead of waiting out the silence timeout. Only shown mid-recording
            in conversation mode, where waiting for the timeout is otherwise the only option. */}
        {conversationMode && isConversationRunning && progress?.stage === 'recording' && (
          <TouchableOpacity style={styles.interruptButton} onPress={handleInterruptTurn}>
            <Text style={styles.interruptButtonText}>Done talking — pass to next person</Text>
          </TouchableOpacity>
        )}

        {/* ── Transcript ──
            Supersedes the old single-turn "Results" box (pre-Conversation-Canvas
            master): every completed turn — single or conversation mode — now
            accumulates here instead of only showing the latest one, and the
            AI-accuracy disclaimer that box used to carry lives below the list. */}
        <View style={styles.section}>
          <View style={styles.sectTitle}>
            <Text style={styles.sectTitleText}>Transcript</Text>
            {turns.length > 0 && <Text style={styles.sectTitleCount}>{turns.length} turn{turns.length === 1 ? '' : 's'}</Text>}
          </View>
          <ChatTranscript
            turns={turns}
            onReplay={handleReplay}
            replayingId={replayingId}
            canReplay={!isActive}
            emptyHint="Your conversation will show up here as it happens — original on one side, translation on the other."
          />
          {turns.length > 0 && (
            <Text style={styles.disclaimerText}>
              AI translations may contain errors. Not intended for medical, legal, or other critical use.
            </Text>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: 13.5,
    color: t.textMuted,
    marginTop: 3,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    marginBottom: 14,
  },
  seg: {
    flexDirection: 'row',
    gap: 6,
    padding: 5,
    borderRadius: 16,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  segItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
  },
  segItemOn: {
    backgroundColor: 'rgba(56,189,248,0.14)',
  },
  segText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: t.textMuted,
  },
  segTextOn: {
    color: t.personB,
  },
  hintBox: {
    backgroundColor: t.personBBg,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 3,
    borderLeftColor: t.personB,
  },
  hintText: {
    fontSize: 12.5,
    color: t.text,
    fontWeight: '500',
    lineHeight: 18,
  },
  interruptButton: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: t.personB,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  interruptButtonText: {
    color: t.personB,
    fontSize: 13,
    fontWeight: '600',
  },
  micSection: {
    alignItems: 'center',
    marginVertical: 18,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
  },
  micButton: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: t.idleGradient[1],
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: t.idleGradient[1],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  micButtonActive: {
    backgroundColor: '#dc2626',
    shadowColor: '#dc2626',
  },
  statusText: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  sectTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  sectTitleText: {
    fontSize: 15.5,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.3,
  },
  sectTitleCount: {
    fontSize: 12,
    fontWeight: '700',
    color: t.textFaint,
  },
  disclaimerText: {
    fontSize: 11,
    color: t.textFaint,
    textAlign: 'center',
    marginTop: 6,
  },
});
