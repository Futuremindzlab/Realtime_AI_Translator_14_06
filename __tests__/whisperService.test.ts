import { shouldAttemptOnDeviceTranscription } from '@/services/whisperService';

// Covers the useOnDevice pinning fix: conversation mode used to re-check
// whisperService.isReady() live on every turn. Since initialize() downloads
// a ~39MB on-device model in the background independent of when a
// conversation actually starts, that live check could flip mid-conversation
// and silently swap the transcription engine (and its accuracy) for the
// same person speaking the same configured language — see
// whisperService.ts's transcribeWithFallback doc comment for the full
// writeup. This is the exact decision matrix that fix relies on: an
// explicit useOnDevice always wins over the live isReady() value,
// CLOUD_ONLY_LANGS and auto-detect always force cloud regardless of either,
// and omitting useOnDevice preserves the old live-check behavior for
// callers (single-translation-mode) that don't need session-long stability.
describe('shouldAttemptOnDeviceTranscription', () => {
  it('uses cloud when the model was never initialized (isReady=false) and nothing is pinned', () => {
    expect(shouldAttemptOnDeviceTranscription('en', undefined, false)).toBe(false);
  });

  it('uses on-device when omitted (live check) and the model is ready, for a non-cloud-only language', () => {
    expect(shouldAttemptOnDeviceTranscription('en', undefined, true)).toBe(true);
  });

  it('pinned useOnDevice=false overrides a live isReady()=true — the actual bug fix', () => {
    expect(shouldAttemptOnDeviceTranscription('en', false, true)).toBe(false);
  });

  it('pinned useOnDevice=true overrides a live isReady()=false (degrades safely inside transcribeWithFallback\'s try/catch, not tested here)', () => {
    expect(shouldAttemptOnDeviceTranscription('en', true, false)).toBe(true);
  });

  it.each(['ml', 'ta', 'te', 'kn', 'hi', 'mr', 'bn', 'gu', 'pa', 'ur', 'ne', 'si', 'ar', 'fa', 'he'])(
    'CLOUD_ONLY_LANGS (%s) always forces cloud, even pinned true and ready',
    (lang) => {
      expect(shouldAttemptOnDeviceTranscription(lang, true, true)).toBe(false);
    }
  );

  it('a region-tagged CLOUD_ONLY_LANGS code (hi-IN) still forces cloud', () => {
    expect(shouldAttemptOnDeviceTranscription('hi-IN', true, true)).toBe(false);
  });

  it('auto-detect (explicit "auto") always forces cloud, even pinned true and ready', () => {
    expect(shouldAttemptOnDeviceTranscription('auto', true, true)).toBe(false);
  });

  it('auto-detect (undefined language) always forces cloud, even pinned true and ready', () => {
    expect(shouldAttemptOnDeviceTranscription(undefined, true, true)).toBe(false);
  });

  it('a non-cloud-only language (Spanish) uses on-device when pinned true and ready', () => {
    expect(shouldAttemptOnDeviceTranscription('es', true, true)).toBe(true);
  });

  it('a non-cloud-only language stays on cloud when not ready and nothing pinned', () => {
    expect(shouldAttemptOnDeviceTranscription('fr', undefined, false)).toBe(false);
  });
});
