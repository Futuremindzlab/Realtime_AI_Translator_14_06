import { Platform } from 'react-native';
import { audioService } from './audioService';
import { whisperService } from './whisperService';
import { ttsService, TTSProvider } from './ttsService';
import { getCachedTranslation, cacheTranslation } from './translationCache';
import { dynamoService } from './dynamoService';
import { resolveLanguage, isCorrectScript, detectScriptLanguage } from '@/lib/constants';

// expo-file-system is native-only — audio history persistence is skipped on
// web, where recording/TTS URIs are blob: URLs FileSystem can't read anyway.
const FileSystem: any = Platform.OS === 'web' ? null : require('expo-file-system/legacy');

const AUDIO_EXTENSION_TO_MIME: Record<string, string> = {
  wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'audio/webm',
};

export interface TranslationProgress {
  stage:
    | 'recording'
    | 'transcribing'
    | 'translating'
    | 'generating_speech'
    | 'playing'
    | 'complete'
    | 'waiting'
    | 'error';
  sourceText?: string;
  translatedText?: string;
  error?: string;
  isRealtime?: boolean;
  currentPerson?: 'A' | 'B';
  currentSourceLanguage?: string;
  currentTargetLanguage?: string;
}

export class RealtimeTranslationService {
  private onProgressCallback: ((progress: TranslationProgress) => void) | null = null;
  private isActive = false;
  private autoContinueEnabled = false;
  private currentSourceLanguage = '';
  private currentTargetLanguage = '';
  private currentTtsProvider: TTSProvider = 'openai';
  private currentUserId: string | undefined;
  private isPersonATurn = true;
  private originalSourceLanguage = '';
  private originalTargetLanguage = '';
  private singleModeMaxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private isStoppingSingleModeRecording = false;

  // Safety cap for single-translation-mode recording (conversation mode already
  // auto-stops at 10s of silence). Without this, a forgotten open mic could record
  // indefinitely — ballooning memory during WAV processing and exceeding the AI
  // proxy's ~6MB Lambda payload ceiling. 90s of 16kHz mono audio stays comfortably
  // under that limit on both the WAV (iOS) and compressed m4a (Android) paths.
  private static readonly SINGLE_MODE_MAX_DURATION_MS = 90_000;

  private clearSingleModeMaxDurationTimer() {
    if (this.singleModeMaxDurationTimer) {
      clearTimeout(this.singleModeMaxDurationTimer);
      this.singleModeMaxDurationTimer = null;
    }
  }

  setProgressCallback(callback: ((progress: TranslationProgress) => void) | null) {
    this.onProgressCallback = callback;
  }

  getIsActive(): boolean {
    return this.isActive;
  }

  private updateProgress(progress: TranslationProgress) {
    if (this.onProgressCallback) {
      this.onProgressCallback({
        ...progress,
        currentPerson: this.isPersonATurn ? 'A' : 'B',
        currentSourceLanguage: this.currentSourceLanguage,
        currentTargetLanguage: this.currentTargetLanguage,
      });
    }
  }

  // Stage-timing instrumentation — no latency numbers existed anywhere in this
  // pipeline before this; used to evidence-base future pipelining/tuning work
  // instead of guessing which stage is actually slow.
  private logDuration(stage: string, startedAt: number) {
    console.log(`⏱️ [${stage}] ${Date.now() - startedAt}ms`);
  }

  // ────────────────────────────────────────────────────────────────
  // Language Mapping: Whisper returns full names, app uses ISO codes
  // ────────────────────────────────────────────────────────────────

  // Complete ISO code → display name map (all languages in SUPPORTED_LANGUAGES)
  private static readonly LANG_CODE_TO_NAME: Record<string, string> = {
    'auto': 'the detected language',
    'en': 'English',    'hi': 'Hindi',       'ta': 'Tamil',       'te': 'Telugu',
    'kn': 'Kannada',    'ml': 'Malayalam',   'mr': 'Marathi',     'bn': 'Bengali',
    'gu': 'Gujarati',   'pa': 'Punjabi',     'ur': 'Urdu',        'es': 'Spanish',
    'fr': 'French',     'de': 'German',      'it': 'Italian',     'pt': 'Portuguese',
    'ru': 'Russian',    'ja': 'Japanese',    'ko': 'Korean',      'zh': 'Chinese',
    'ar': 'Arabic',     'tr': 'Turkish',     'th': 'Thai',        'vi': 'Vietnamese',
    'id': 'Indonesian', 'nl': 'Dutch',       'pl': 'Polish',      'uk': 'Ukrainian',
    'cs': 'Czech',      'fil': 'Filipino',   'sv': 'Swedish',     'da': 'Danish',
    'no': 'Norwegian',  'fi': 'Finnish',     'el': 'Greek',       'hu': 'Hungarian',
    'ro': 'Romanian',   'sk': 'Slovak',      'bg': 'Bulgarian',   'sr': 'Serbian',
    'he': 'Hebrew',     'ca': 'Catalan',     'fa': 'Persian',     'ms': 'Malay',
    'sw': 'Swahili',    'hr': 'Croatian',    'ne': 'Nepali',      'si': 'Sinhala',
  };

  // Whisper API returns language names that may differ from our display names.
  // These aliases map Whisper-specific strings directly to ISO codes.
  private static readonly WHISPER_ALIASES: Record<string, string> = {
    'tagalog':    'fil', // Whisper says "tagalog"; we use Filipino (fil)
    'mandarin':   'zh',  // Whisper may say "mandarin" instead of "chinese"
    'cantonese':  'zh',  // Cantonese → map to Chinese
    'castilian':  'es',  // Spanish alias
    'flemish':    'nl',  // Dutch alias
    'burmese':    'my',
    'moldavian':  'ro',
    'moldovan':   'ro',
    'nynorsk':    'no',
    'valencian':  'ca',
    'pashto':     'ps',
    'sinhalese':  'si',
    'odia':       'or',
    'assamese':   'as',
  };

  private static readonly LANG_NAME_TO_CODE: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    for (const [code, name] of Object.entries(RealtimeTranslationService.LANG_CODE_TO_NAME)) {
      if (code !== 'auto') map[name.toLowerCase()] = code;
    }
    return map;
  })();

  private whisperLanguageToCode(whisperLang: string): string {
    if (!whisperLang) return 'en';
    const lower = whisperLang.toLowerCase().trim();
    // Already a known ISO code
    if (RealtimeTranslationService.LANG_CODE_TO_NAME[lower]) return lower;
    // Whisper-specific alias (tagalog→fil, mandarin→zh, etc.)
    const alias = RealtimeTranslationService.WHISPER_ALIASES[lower];
    if (alias) return alias;
    // Standard name → code lookup (english→en, malayalam→ml, etc.)
    const fromName = RealtimeTranslationService.LANG_NAME_TO_CODE[lower];
    if (fromName) return fromName;
    // Unknown language — return as-is; callers handle gracefully
    console.warn(`[whisperLanguageToCode] Unmapped language: "${whisperLang}"`);
    return lower;
  }

  private getLanguageNameFromCode(code: string): string {
    return RealtimeTranslationService.LANG_CODE_TO_NAME[code] || code.toUpperCase();
  }

  /**
   * Resolve Whisper's raw detected-language string to an ISO code, then cross-check
   * it against the actual transcribed text's script. Whisper's `language` field
   * confuses closely related Indic languages (e.g. reports "tamil" for Malayalam
   * audio) far more often than its transcription itself is wrong, so when the
   * declared language's script doesn't match the transcribed characters, trust
   * the text over the declared language.
   */
  private resolveDetectedLanguage(rawDetected: string | undefined, text: string): string | undefined {
    if (!rawDetected) return undefined;
    const code = this.whisperLanguageToCode(rawDetected);
    if (text && !isCorrectScript(text, code)) {
      const scriptMatch = detectScriptLanguage(text);
      if (scriptMatch && scriptMatch !== code) {
        console.warn(`⚠️ Whisper declared "${code}" but transcribed text script is "${scriptMatch}" — correcting label`);
        return scriptMatch;
      }
    }
    return code;
  }

  // ────────────────────────────────────────────────────────────────
  // Translation (Direct OpenAI)
  // ────────────────────────────────────────────────────────────────

  private async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    // Check translation cache first (AsyncStorage, 30-day TTL)
    const cached = await getCachedTranslation(text, sourceLanguage, targetLanguage);
    if (cached) {
      console.log('⚡ [TranslationCache] Cache hit — skipping translation provider');
      onChunk(cached);
      return cached;
    }

    // Delegate to translationProvider which may implement OpenAI streaming or a device/local model.
    const { translationProvider } = await import('./translationProvider');

    const result = await translationProvider.translate(text, sourceLanguage, targetLanguage, (chunk) => {
      onChunk(chunk);
    });

    // Persist to cache for future calls
    cacheTranslation(text, sourceLanguage, targetLanguage, result).catch(() => {});

    console.log(`✅ Translation: "${result.substring(0, 80)}"`);
    return result;
  }

  

  // ────────────────────────────────────────────────────────────────
  // SINGLE TRANSLATION MODE (conversation toggle OFF)
  // User presses start → speaks → presses stop → processes → done
  // ────────────────────────────────────────────────────────────────

  async startRealtimeRecording(
    sourceLanguage: string,
    targetLanguage: string,
    ttsProvider: TTSProvider = 'openai',
    userId?: string,
  ): Promise<void> {
    this.isActive = true;
    this.autoContinueEnabled = false;
    this.currentTtsProvider = ttsProvider;
    this.currentUserId = userId;
    this.isPersonATurn = true;
    this.currentSourceLanguage = sourceLanguage;
    this.currentTargetLanguage = targetLanguage;
    this.originalSourceLanguage = sourceLanguage;
    this.originalTargetLanguage = targetLanguage;

    console.log(`🎤 Single mode: ${sourceLanguage} → ${targetLanguage}`);
    this.updateProgress({ stage: 'recording', isRealtime: true });
    await audioService.startRecording();

    this.clearSingleModeMaxDurationTimer();
    this.singleModeMaxDurationTimer = setTimeout(() => {
      if (this.isActive && !this.autoContinueEnabled) {
        console.warn('⏱️ Single mode: max recording duration reached, auto-stopping');
        this.stopRealtimeRecording();
      }
    }, RealtimeTranslationService.SINGLE_MODE_MAX_DURATION_MS);
  }

  async stopRealtimeRecording(): Promise<void> {
    // Re-entrancy guard: the safety timer (see startRealtimeRecording) can fire this
    // concurrently with a manual stop tap. Without this, a double call could race on
    // audioService.stopRecording() and clobber the first call's in-flight progress.
    if (this.isStoppingSingleModeRecording) return;
    this.isStoppingSingleModeRecording = true;
    this.clearSingleModeMaxDurationTimer();

    let lastSourceText = '';
    let lastTranslatedText = '';

    try {
      console.log('=== SINGLE TRANSLATION FLOW ===');
      const pipelineStartedAt = Date.now();
      const audioUri = await audioService.stopRecording();

      if (!audioUri) {
        this.updateProgress({ stage: 'error', error: 'No audio recorded' });
        this.isActive = false;
        return;
      }

      // Transcribe (on-device whisper.rn with cloud fallback)
      this.updateProgress({ stage: 'transcribing', isRealtime: true });
      const transcribeStartedAt = Date.now();
      const { text: sourceText, detectedLanguage: rawDetected } = await whisperService.transcribeWithFallback(
        audioUri, this.currentSourceLanguage
      );
      this.logDuration('transcribe', transcribeStartedAt);

      const detectedLanguage = this.resolveDetectedLanguage(rawDetected, sourceText || '');
      console.log(`📝 Transcribed: "${sourceText?.substring(0, 80)}" (detected: ${detectedLanguage})`);

      // Use detected language if source was auto.
      // Safety: if detected language matches the target language, the model almost
      // certainly misidentified the input (you can't translate X→X). In that case
      // fall back to English so at least the transcribed text is passed through.
      if (this.currentSourceLanguage === 'auto' && detectedLanguage) {
        if (detectedLanguage === this.currentTargetLanguage) {
          console.warn(`⚠️ Detected language (${detectedLanguage}) === target — likely misdetection, defaulting to en`);
          this.currentSourceLanguage = 'en';
        } else {
          this.currentSourceLanguage = detectedLanguage;
          console.log(`✅ Auto-detected: ${detectedLanguage} (${this.getLanguageNameFromCode(detectedLanguage)})`);
        }
      } else if (this.currentSourceLanguage === 'auto') {
        this.currentSourceLanguage = 'en';
        console.warn('⚠️ No language detected, defaulting to English');
      }

      const actualText = (typeof sourceText === 'string' ? sourceText : '').trim();
      if (!actualText || actualText.length < 3) {
        this.updateProgress({ stage: 'error', error: 'No speech detected — please speak clearly and try again' });
        this.isActive = false;
        return;
      }

      lastSourceText = actualText;

      // Translate
      const srcLang = resolveLanguage(this.currentSourceLanguage);
      const tgtLang = resolveLanguage(this.currentTargetLanguage);
      console.log(`📝 Translating: ${this.currentSourceLanguage} (${srcLang.name}) → ${this.currentTargetLanguage} (${tgtLang.name} / ${tgtLang.nativeName})`);
      this.updateProgress({
        stage: 'translating',
        sourceText: actualText,
        isRealtime: true,
      });

      let translatedText = '';
      const translateStartedAt = Date.now();
      await this.translate(
        actualText,
        this.currentSourceLanguage,
        this.currentTargetLanguage,
        (chunk) => {
          translatedText += chunk;
          this.updateProgress({
            stage: 'translating',
            sourceText: actualText,
            translatedText,
            isRealtime: true,
          });
        }
      );
      this.logDuration('translate', translateStartedAt);

      if (!translatedText.trim()) {
        throw new Error('Translation returned empty result');
      }

      lastTranslatedText = translatedText;

      console.log(`📝 Source text: "${actualText}"`);
      console.log(`📝 Translated to ${tgtLang.name}: "${translatedText}"`);

      // Generate TTS
      this.updateProgress({
        stage: 'generating_speech',
        sourceText: actualText,
        translatedText,
        isRealtime: true,
      });

      const ttsStartedAt = Date.now();
      const ttsUri = await ttsService.generateSpeech(
        translatedText, this.currentTargetLanguage, this.currentTtsProvider
      );
      this.logDuration('tts_generate', ttsStartedAt);

      // Play audio (ttsUri is null for 'device' provider — expo-speech already spoke)
      await audioService.forceCleanup();
      this.updateProgress({
        stage: 'playing',
        sourceText: actualText,
        translatedText,
        isRealtime: true,
      });
      this.logDuration('time_to_first_audio', pipelineStartedAt);

      if (ttsUri) {
        try {
          const playStartedAt = Date.now();
          await audioService.playAudio(ttsUri);
          this.logDuration('playback', playStartedAt);
          console.log('✅ Audio playback complete');
        } catch (playError) {
          console.error('❌ Audio playback failed:', playError);
        }
      }

      // Save to history
      await this.saveToHistory(
        this.currentSourceLanguage,
        this.currentTargetLanguage,
        actualText,
        translatedText,
        false,
        audioUri,
        ttsUri,
      );

      // Done
      this.logDuration('total_turn', pipelineStartedAt);
      this.updateProgress({
        stage: 'complete',
        sourceText: actualText,
        translatedText,
        isRealtime: true,
      });
      this.isActive = false;

    } catch (error) {
      console.error('❌ Single translation error:', error);
      this.isActive = false;
      this.updateProgress({
        stage: 'error',
        error: error instanceof Error ? error.message : 'Translation failed',
        sourceText: lastSourceText || undefined,
        translatedText: lastTranslatedText || undefined,
      });
      await audioService.cleanup();
    } finally {
      this.isStoppingSingleModeRecording = false;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // CONVERSATION MODE (conversation toggle ON)
  // Fully automatic: record → transcribe → translate → TTS → play → swap → repeat
  // User presses start once, presses stop to end.
  // ────────────────────────────────────────────────────────────────

  async startConversation(
    sourceLanguage: string,
    targetLanguage: string,
    ttsProvider: TTSProvider = 'openai',
    userId?: string
  ): Promise<void> {
    this.isActive = true;
    this.autoContinueEnabled = true;
    this.isPersonATurn = true;
    this.originalSourceLanguage = sourceLanguage;
    this.originalTargetLanguage = targetLanguage;
    this.currentSourceLanguage = sourceLanguage;
    this.currentTargetLanguage = targetLanguage;
    this.currentTtsProvider = ttsProvider;
    this.currentUserId = userId;

    console.log('🗣️ ═══════════════════════════════════');
    console.log(`🗣️ CONVERSATION STARTED: ${sourceLanguage} ↔ ${targetLanguage}`);
    console.log('🗣️ ═══════════════════════════════════');

    // Run the conversation loop (blocks until stopped)
    await this.conversationLoop();
  }

  stopConversation(): void {
    console.log('🛑 CONVERSATION STOPPED by user');
    this.isActive = false;
    this.autoContinueEnabled = false;
    // Stop any in-progress recording or playback immediately
    audioService.forceCleanup().catch(() => {});
  }

  private async conversationLoop(): Promise<void> {
    let consecutiveErrors = 0;
    const MAX_ERRORS = 3;

    while (this.isActive && this.autoContinueEnabled) {
      const person = this.isPersonATurn ? 'A' : 'B';

      try {
        console.log(`\n═══ Person ${person}'s turn ═══`);
        console.log(`   ${this.currentSourceLanguage} → ${this.currentTargetLanguage}`);

        // ── STEP 1: RECORD (auto-stops on silence, max 10s) ──
        this.updateProgress({ stage: 'recording', isRealtime: true });
        console.log(`🎤 Recording for Person ${person} (max 10s, auto-stops on 2.5s silence)...`);

        // startRecordingWithAutoStop starts the recording and returns its URI when done:
        // - stops automatically after 2.5s of silence following at least 1.5s of speech
        // - hard-caps at 10s regardless
        // - returns null if forceCleanup() was called externally (e.g. stopConversation())
        const audioUri = await audioService.startRecordingWithAutoStop(10000, -45, 2500, 1500);
        console.log(`🎤 Recording: ${audioUri ? 'OK' : 'null'}`);

        if (!this.isActive || !this.autoContinueEnabled) break;

        if (!audioUri) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_ERRORS) {
            this.updateProgress({ stage: 'error', error: 'Recording failed. Please restart.', isRealtime: true });
            break;
          }
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        // ── STEP 2: PROCESS (transcribe → translate → TTS → play) ──
        const success = await this.processConversationTurn(audioUri);

        if (!this.isActive || !this.autoContinueEnabled) break;

        if (success) {
          consecutiveErrors = 0;

          // ── STEP 3: SWAP languages ──
          this.isPersonATurn = !this.isPersonATurn;
          if (this.isPersonATurn) {
            this.currentSourceLanguage = this.originalSourceLanguage;
            this.currentTargetLanguage = this.originalTargetLanguage;
          } else {
            this.currentSourceLanguage = this.originalTargetLanguage;
            this.currentTargetLanguage = this.originalSourceLanguage;
          }
          console.log(`🔄 Next → Person ${this.isPersonATurn ? 'A' : 'B'}: ${this.currentSourceLanguage} → ${this.currentTargetLanguage}`);

          // Brief pause, then ensure audio resources are released before next recording
          this.updateProgress({ stage: 'waiting', isRealtime: true });
          await new Promise(r => setTimeout(r, 1000));
          await audioService.forceCleanup();
          await new Promise(r => setTimeout(r, 200));
        } else {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_ERRORS) {
            this.updateProgress({ stage: 'error', error: 'No speech detected. Please restart.', isRealtime: true });
            break;
          }
          await new Promise(r => setTimeout(r, 500));
        }

      } catch (error) {
        consecutiveErrors++;
        console.error(`❌ Turn error (${consecutiveErrors}/${MAX_ERRORS}):`, error);
        // Ensure we clean up any leftover audio state
        await audioService.forceCleanup().catch(() => {});

        if (consecutiveErrors >= MAX_ERRORS) {
          this.updateProgress({
            stage: 'error',
            error: error instanceof Error ? error.message : 'Conversation failed.',
            isRealtime: true,
          });
          break;
        }
        this.updateProgress({
          stage: 'error',
          error: error instanceof Error ? error.message : 'Error, retrying...',
          isRealtime: true,
        });
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    console.log('🗣️ Conversation loop ended');
    this.isActive = false;
    this.autoContinueEnabled = false;
    await audioService.forceCleanup().catch(() => {});
  }

  /**
   * Process one conversation turn: transcribe → translate → TTS → play audio.
   * Returns true if turn was successful (should swap), false to retry same person.
   */
  private async processConversationTurn(audioUri: string): Promise<boolean> {
    const pipelineStartedAt = Date.now();

    // ── 1. TRANSCRIBE ──
    this.updateProgress({ stage: 'transcribing', isRealtime: true });

    const transcribeStartedAt = Date.now();
    const { text: sourceText, detectedLanguage: rawDetected } = await whisperService.transcribeWithFallback(
      audioUri, this.currentSourceLanguage
    );
    this.logDuration('transcribe', transcribeStartedAt);

    const actualText = (typeof sourceText === 'string' ? sourceText : '').trim();
    const detectedLanguage = this.resolveDetectedLanguage(rawDetected, actualText);

    console.log(`📝 Transcribed: "${actualText.substring(0, 80)}" | Detected: ${detectedLanguage}`);

    // Skip if no valid speech
    if (!actualText || actualText.length < 3) {
      console.log('⚠️ No valid speech, will retry');
      this.updateProgress({ stage: 'waiting', isRealtime: true });
      return false;
    }

    // ── Resolve 'auto' source on Person A's first turn ──
    // If 'auto' isn't resolved here, the swap logic will set currentTargetLanguage
    // to 'auto' on Person B's turn, which breaks the translation prompt.
    // Safety: if detected language === target language, treat as misdetection (X→X is invalid).
    if (this.isPersonATurn && this.originalSourceLanguage === 'auto') {
      let resolved = 'en';
      if (detectedLanguage && detectedLanguage !== this.currentTargetLanguage) {
        resolved = detectedLanguage;
        console.log(`🔒 Locked Person A's language (detected): ${detectedLanguage} (${this.getLanguageNameFromCode(detectedLanguage)})`);
      } else if (detectedLanguage) {
        console.warn(`⚠️ Detected language (${detectedLanguage}) === target — likely misdetection, defaulting Person A to English`);
      } else {
        console.warn(`⚠️ No language detected — defaulting Person A's source to English`);
      }
      this.originalSourceLanguage = resolved;
      this.currentSourceLanguage = resolved;
    }
    // For subsequent turns, currentSourceLanguage/currentTargetLanguage are set
    // by the swap logic in conversationLoop — don't override them here.

    console.log(`📝 Translation: ${this.currentSourceLanguage} (${this.getLanguageNameFromCode(this.currentSourceLanguage)}) → ${this.currentTargetLanguage} (${this.getLanguageNameFromCode(this.currentTargetLanguage)})`);

    // ── 2. TRANSLATE ──
    this.updateProgress({
      stage: 'translating',
      sourceText: actualText,
      isRealtime: true,
    });

    let translatedText = '';
    const translateStartedAt = Date.now();
    await this.translate(
      actualText,
      this.currentSourceLanguage,
      this.currentTargetLanguage,
      (chunk) => {
        translatedText += chunk;
        this.updateProgress({
          stage: 'translating',
          sourceText: actualText,
          translatedText,
          isRealtime: true,
        });
      }
    );
    this.logDuration('translate', translateStartedAt);

    if (!translatedText.trim()) {
      console.error('❌ Empty translation result');
      return false;
    }

    console.log(`✅ Translated: "${translatedText.substring(0, 80)}"`);

    // ── 3. GENERATE TTS ──
    this.updateProgress({
      stage: 'generating_speech',
      sourceText: actualText,
      translatedText,
      isRealtime: true,
    });

    const ttsStartedAt = Date.now();
    const ttsUri = await ttsService.generateSpeech(
      translatedText, this.currentTargetLanguage, this.currentTtsProvider
    );
    this.logDuration('tts_generate', ttsStartedAt);
    console.log(`✅ TTS generated`);

    // ── 4. PLAY AUDIO (MUST complete before next turn) ──
    // Recording is already stopped (stopRecording was called in conversationLoop).
    // ttsUri is null when 'device' provider is used (expo-speech already spoke inline).
    this.updateProgress({
      stage: 'playing',
      sourceText: actualText,
      translatedText,
      isRealtime: true,
    });
    this.logDuration('time_to_first_audio', pipelineStartedAt);

    if (ttsUri) {
      try {
        const playStartedAt = Date.now();
        await audioService.playAudio(ttsUri);
        this.logDuration('playback', playStartedAt);
        console.log('✅ Audio playback complete');
      } catch (playError) {
        console.error('❌ Audio playback failed (translation was successful):', playError);
      }
    }

    // Save to history
    await this.saveToHistory(
      this.currentSourceLanguage,
      this.currentTargetLanguage,
      actualText,
      translatedText,
      true,
      audioUri,
      ttsUri,
    );

    this.logDuration('total_turn', pipelineStartedAt);

    // Turn processed successfully — don't set 'complete' here
    // (the conversation loop will set 'waiting' before the next turn,
    //  and forceCleanup at the top of the next iteration handles resource release)
    return true;
  }

  // ────────────────────────────────────────────────────────────────
  // History
  // ────────────────────────────────────────────────────────────────

  /**
   * Read a local recording/TTS file back into base64 for the history-upload
   * request. Returns null (never throws) on web, for a null/undefined uri, or
   * on any read failure — audio persistence is best-effort and must never
   * block saving the text history entry itself.
   */
  private async readAudioForUpload(
    uri: string | null | undefined
  ): Promise<{ base64: string; contentType: string } | null> {
    if (!uri || !FileSystem) return null;
    try {
      const extension = uri.split('.').pop()?.toLowerCase().split('?')[0] ?? '';
      const contentType = AUDIO_EXTENSION_TO_MIME[extension];
      if (!contentType) return null;

      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      if (!base64) return null;
      return { base64, contentType };
    } catch (err) {
      console.warn('[RealtimeTranslationService] Failed to read audio for history upload:', err);
      return null;
    }
  }

  private async saveToHistory(
    sourceLanguage: string,
    targetLanguage: string,
    sourceText: string,
    translatedText: string,
    conversationMode: boolean,
    sourceAudioUri?: string | null,
    translatedAudioUri?: string | null,
  ): Promise<void> {
    if (!this.currentUserId || !dynamoService.isInitialized()) return;
    try {
      const [sourceAudio, translatedAudio] = await Promise.all([
        this.readAudioForUpload(sourceAudioUri),
        this.readAudioForUpload(translatedAudioUri),
      ]);

      await dynamoService.putConversationHistory({
        user_id: this.currentUserId,
        timestamp: new Date().toISOString(),
        source_language: sourceLanguage,
        target_language: targetLanguage,
        source_text: sourceText,
        translated_text: translatedText,
        conversation_mode: conversationMode,
        created_at: new Date().toISOString(),
        ...(sourceAudio ? {
          source_audio_base64: sourceAudio.base64,
          source_audio_content_type: sourceAudio.contentType,
        } : {}),
        ...(translatedAudio ? {
          translated_audio_base64: translatedAudio.base64,
          translated_audio_content_type: translatedAudio.contentType,
        } : {}),
      });
      console.log('✅ Saved to history');
    } catch (error) {
      console.error('❌ Failed to save to history:', error);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Utility methods
  // ────────────────────────────────────────────────────────────────

  getCurrentPerson(): 'A' | 'B' {
    return this.isPersonATurn ? 'A' : 'B';
  }

  getCurrentDirection(): { source: string; target: string } {
    return {
      source: this.currentSourceLanguage,
      target: this.currentTargetLanguage,
    };
  }

  isConversationActive(): boolean {
    return this.isActive && this.autoContinueEnabled;
  }

  async forceReset(): Promise<void> {
    console.log('Force resetting translation service...');
    this.clearSingleModeMaxDurationTimer();
    this.isActive = false;
    this.autoContinueEnabled = false;
    this.isPersonATurn = true;
    await audioService.cleanup();
    this.updateProgress({ stage: 'complete' });
  }

  async cleanup(): Promise<void> {
    this.clearSingleModeMaxDurationTimer();
    this.isActive = false;
    this.autoContinueEnabled = false;
    await audioService.cleanup();
  }
}

export const realtimeTranslationService = new RealtimeTranslationService();
