import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import { preprocessForWhisper } from './audioProcessor';
import { logger } from '@/lib/logger';

// expo-file-system is native-only. On web, TTS audio arrives as blob: URLs and
// recording produces blob: URIs — neither path touches FileSystem, so a no-op
// stub is sufficient to keep the web bundle from erroring on the import.
const FileSystem: any = Platform.OS === 'web'
  ? { getInfoAsync: async () => ({ exists: true, size: 1 }), cacheDirectory: '' }
  : require('expo-file-system/legacy');

export class AudioService {
  private recording: Audio.Recording | null = null;
  private sound: Audio.Sound | null = null;
  private isChunkedRecording = false;
  private chunkTimer: any = null;
  private onChunkReady: ((uri: string) => void) | null = null;
  private audioMode: 'idle' | 'recording' | 'playback' = 'idle';
  // Feature: immediate-stop control. Holds the pending auto-stop recording's
  // finalizer while one is in flight, so interruptAutoStop() can end the turn
  // right now instead of waiting for the silence/fixed-duration timers.
  private pendingAutoStopFinish: (() => void) | null = null;

  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      return false;
    }
  }

  async startRecording(): Promise<void> {
    try {
      // If we're in playback mode, clean up first
      if (this.audioMode === 'playback') {
        await this.forceCleanup();
      }

      // Ensure no leftover audio objects from previous operations
      if (this.recording) {
        try { await this.recording.stopAndUnloadAsync(); } catch (e) {}
        this.recording = null;
      }
      if (this.sound) {
        try { await this.sound.stopAsync(); await this.sound.unloadAsync(); } catch (e) {}
        this.sound = null;
      }

      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        throw new Error('Microphone permission not granted');
      }

      console.log('🎤 Setting audio mode for recording...');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      this.audioMode = 'recording';

      // Platform-aware delay to let audio subsystem settle after mode switch
      const modeSettleDelay = Platform.OS === 'android' ? 250 : 100;
      await new Promise(r => setTimeout(r, modeSettleDelay));

      // Android: MPEG_4 container + AAC encoder → .m4a
      // AndroidOutputFormat.DEFAULT (0) produces a 3GPP/AMR file even with a .wav
      // extension — OpenAI Whisper reads the actual bytes and rejects it as
      // "Invalid File Format". MPEG_4+AAC is reliable on all Android versions and
      // is accepted by both OpenAI Whisper API and whisper.rn (whisper.cpp with libav).
      //
      // iOS: Linear PCM .wav — whisper.rn's native CoreAudio path handles it optimally.
      const recordingOptions = {
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.MAX,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      };

      console.log('🎤 Creating recording object...');
      const { recording } = await Audio.Recording.createAsync(recordingOptions);
      this.recording = recording;
      console.log('✅ Recording started successfully (WAV, 16 kHz, mono)');
    } catch (error) {
      console.error('❌ Start Recording Error:', error);
      this.recording = null;
      this.audioMode = 'idle';
      throw error;
    }
  }

  async stopRecording(): Promise<string | null> {
    try {
      if (!this.recording) {
        console.warn('⚠️ stopRecording called but no recording exists');
        return null;
      }
      const recording = this.recording;
      this.recording = null; // Clear reference first to prevent double-stop
      await recording.stopAndUnloadAsync();
      this.audioMode = 'idle';
      const uri = recording.getURI();
      console.log(`🎤 Recording stopped, URI: ${uri ? 'ok' : 'null'}`);
      if (!uri) return null;
      // Normalize + VAD-strip before handing to Whisper (iOS WAV only; Android no-op)
      return await preprocessForWhisper(uri);
    } catch (error) {
      console.error('❌ stopRecording error:', error);
      this.recording = null;
      this.audioMode = 'idle';
      return null;
    }
  }

  // Alias for your translation service
  async cleanup(): Promise<void> {
    await this.forceCleanup();
  }

  async forceCleanup(): Promise<void> {
    console.log('🧹 Force cleaning up audio objects...');

    // Clean up recording
    if (this.recording) {
      try {
        await this.recording.stopAndUnloadAsync();
        console.log('✅ Recording cleaned up');
      } catch (e) {
        console.warn('Warning cleaning recording:', e);
      }
      this.recording = null;
    }

    // Clean up sound
    if (this.sound) {
      try {
        await this.sound.stopAsync();
        await this.sound.unloadAsync();
        console.log('✅ Sound cleaned up');
      } catch (e) {
        console.warn('Warning cleaning sound:', e);
      }
      this.sound = null;
    }

    this.audioMode = 'idle';

    // Increased delay to ensure cleanup completes on all devices
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log('✅ Audio cleanup complete');
  }

  // --- AUDIO PLAYBACK ---
  async playAudio(audioUrl: string): Promise<void> {
    const MAX_RETRIES = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`🔊 Retrying playback (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise(r => setTimeout(r, 300));
        }
        await this.playAudioInternal(audioUrl);
        return; // Success
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ Playback attempt ${attempt + 1} failed:`, error);
      }
    }

    console.error('❌ All playback attempts failed:', lastError);
    // Don't throw - let conversation continue even if audio fails
  }

  private async playAudioInternal(audioUrl: string): Promise<void> {
    try {
      console.log('🔊 Setting up audio playback...');

      // If we're in recording mode, clean up first
      if (this.audioMode === 'recording') {
        console.log('⚠️ Still in recording mode, forcing cleanup before playback');
        await this.forceCleanup();
      }

      // 1. Validate audio file exists and has content
      if (audioUrl.startsWith('file://') || audioUrl.startsWith('/')) {
        const fileInfo = await FileSystem.getInfoAsync(audioUrl);
        if (!fileInfo.exists) {
          throw new Error('Audio file does not exist');
        }
        if ((fileInfo as any).size === 0) {
          throw new Error('Audio file is empty (0 bytes)');
        }
        console.log(`🔊 Audio file validated: ${((fileInfo as any).size / 1024).toFixed(1)} KB`);
      }

      // 2. Unload any existing sound
      if (this.sound) {
        try { await this.sound.unloadAsync(); } catch (e) {}
        this.sound = null;
      }

      // 3. CRITICAL: Switch audio mode from recording to playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,     // Must be false for playback!
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false, // Use speaker
      });

      this.audioMode = 'playback';
      console.log('🔊 Audio mode set for playback');

      // Platform-aware delay after mode switch
      if (Platform.OS === 'android') {
        await new Promise(r => setTimeout(r, 150));
      }

      // 4. Load AND play in one step (recommended by Expo docs)
      console.log(`🔊 Loading: ${audioUrl}`);
      const { sound, status } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true, volume: 1.0, progressUpdateIntervalMillis: 500 }
      );
      this.sound = sound;

      if (status.isLoaded) {
        console.log(`🔊 Loaded & playing! Duration: ${status.durationMillis}ms`);
      } else {
        console.error('❌ Sound failed to load');
        this.audioMode = 'idle';
        return;
      }

      // 5. Wait for playback to finish
      await new Promise<void>((resolve) => {
        let resolved = false;

        sound.setOnPlaybackStatusUpdate(async (playStatus) => {
          if (resolved) return;

          if (playStatus.isLoaded) {
            if (playStatus.didJustFinish) {
              resolved = true;
              console.log('✅ Audio playback finished');
              try {
                await sound.unloadAsync();
                this.sound = null;
              } catch (e) {}
              this.audioMode = 'idle';
              resolve();
            }
          }
        });

        // Safety timeout matching February folder: duration + 2s, defaulting to 5s if unknown.
        // Keeps the pipeline from hanging more than ~7s for a short clip.
        const duration = (status.isLoaded && status.durationMillis && status.durationMillis > 0)
          ? status.durationMillis : 5000;
        const timeoutMs = duration + 2000;
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.warn(`⚠️ Audio timeout after ${timeoutMs}ms, continuing...`);
            try { sound.unloadAsync(); } catch (e) {}
            this.sound = null;
            this.audioMode = 'idle';
            resolve();
          }
        }, timeoutMs);
      });

    } catch (error) {
      console.error('❌ Playback Error:', error);
      this.audioMode = 'idle';
      throw error; // Rethrow so retry logic in playAudio() can catch it
    }
  }

  /**
   * Record with automatic stop on silence detection.
   * Falls back to a fixed timer if metering is not available on the device.
   */
  async startRecordingWithAutoStop(
    fixedDurationMs: number = 10000,
    silenceThresholdDb: number = -45,
    silenceDurationMs: number = 3000,
    minRecordingMs: number = 2000
  ): Promise<string | null> {
    console.log(`🎤 [AutoStop] Starting recording (max ${fixedDurationMs / 1000}s, silence ${silenceDurationMs / 1000}s)`);

    await this.startRecording();
    if (!this.recording) {
      console.error('🎤 [AutoStop] Recording failed to start');
      logger.error('AutoStop: startRecording() left this.recording null', undefined, { platform: Platform.OS });
      return null;
    }

    const recording = this.recording;
    const recordingStart = Date.now();

    // Wait briefly for recording to stabilize before attaching listeners
    await new Promise(r => setTimeout(r, 300));

    // If recording was stopped externally during the wait — diagnostic: this
    // path (not the status-callback one already fixed) is the other possible
    // explanation for "Listening… appears then disappears instantly" if
    // something else in the app (e.g. a spurious AppState 'background' event)
    // is calling forceCleanup()/stopRecording() within this 300ms window.
    if (this.recording !== recording) {
      console.log('🎤 [AutoStop] Recording stopped during startup');
      logger.warn('AutoStop: recording instance changed during 300ms startup wait — something else stopped it', {
        platform: Platform.OS,
      });
      return null;
    }

    return new Promise<string | null>((resolve) => {
      let silenceStart: number | null = null;
      let hasSpeech = false;
      let resolved = false;

      const finish = async () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(fallbackTimer);
        this.pendingAutoStopFinish = null;
        console.log(`🎤 [AutoStop] Finishing recording (hasSpeech=${hasSpeech})`);
        if (this.recording === recording) {
          const uri = await this.stopRecording();
          resolve(uri);
        } else {
          resolve(null);
        }
      };

      // Expose this turn's finalizer so interruptAutoStop() (feature: immediate
      // stop, e.g. a "stop talking" button) can end it early — same finalize path
      // as the silence timer, just triggered on demand instead of by elapsed time.
      this.pendingAutoStopFinish = finish;

      // Fallback: fixed duration timer (always works, even without metering)
      const fallbackTimer = setTimeout(() => {
        console.log(`⏱️ [AutoStop] Fixed timer ${fixedDurationMs / 1000}s reached`);
        finish();
      }, fixedDurationMs);

      // Try to use metering for smarter silence detection
      try {
        recording.setOnRecordingStatusUpdate((status: any) => {
          if (resolved) return;

          // GUARD: Ignore status updates during first 1 second
          const elapsed = Date.now() - recordingStart;
          if (elapsed < 1000) return;

          if (!status.isRecording) {
            // Bug fix: this native status field was being trusted at face value
            // to mean "the recording was stopped externally" (e.g. by
            // stopConversation() -> forceCleanup()). On Android it has been
            // observed to report false spuriously shortly after a perfectly
            // successful start — with nothing in our own code having stopped
            // anything — which bailed the whole turn out with a null result on
            // the very first metering callback. On screen that reads as
            // "Person A: Listening…" flashing and disappearing almost
            // instantly. Single Translation mode's manual start/stop recording
            // never attaches this status callback at all and is unaffected,
            // which is exactly the signature of a bug in this callback, not in
            // recording itself.
            //
            // The only signal that WE intentionally stopped this recording is
            // our own instance reference changing (set by stopRecording() /
            // forceCleanup()) — plain JS state, not a value reported by the
            // native bridge. Trust that instead of this field.
            if (this.recording !== recording) {
              console.log('🎤 [AutoStop] Recording stopped externally (instance changed)');
              if (!resolved) {
                resolved = true;
                clearTimeout(fallbackTimer);
                this.pendingAutoStopFinish = null;
                resolve(null);
              }
            } else {
              console.warn('⚠️ [AutoStop] Ignoring spurious isRecording=false (recording instance unchanged)');
              logger.warn('AutoStop: ignored spurious isRecording=false from native status callback', {
                platform: Platform.OS, elapsedMs: elapsed,
              });
            }
            return;
          }

          if (elapsed < minRecordingMs) return;

          const metering: number | undefined = status.metering;
          if (metering !== undefined) {
            if (metering >= silenceThresholdDb) {
              hasSpeech = true;
              silenceStart = null;
            } else if (hasSpeech) {
              if (!silenceStart) {
                silenceStart = Date.now();
              } else if (Date.now() - silenceStart >= silenceDurationMs) {
                console.log(`🔇 [AutoStop] ${silenceDurationMs / 1000}s silence after speech`);
                finish();
              }
            }
          }
        });

        recording.setProgressUpdateInterval(250);
        console.log('🎤 [AutoStop] Metering listener attached');
      } catch (e) {
        console.warn('⚠️ [AutoStop] Metering not supported, using fixed timer only');
      }
    });
  }

  isRecording(): boolean { return this.recording !== null; }

  /**
   * Feature: immediate-stop control. Ends the in-flight startRecordingWithAutoStop()
   * turn right now — same finalize path as a silence-timeout, just triggered on
   * demand (e.g. a "stop talking" button) instead of by elapsed time. No-op if no
   * auto-stop recording is currently in flight.
   */
  interruptAutoStop(): void {
    if (this.pendingAutoStopFinish) {
      console.log('⏭️ [AutoStop] Interrupted externally — finishing turn now');
      this.pendingAutoStopFinish();
    } else {
      console.log('⏭️ [AutoStop] Interrupt requested but no auto-stop recording is in flight');
    }
  }
}

export const audioService = new AudioService();
