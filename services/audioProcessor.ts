/**
 * audioProcessor.ts — Client-side audio preprocessing before Whisper submission.
 *
 * iOS (WAV/PCM): full pipeline — normalize RMS to -20 dBFS, strip leading/trailing silence.
 * Android (m4a/AAC): cannot decode compressed audio in JS without a native codec;
 *   returns the original URI unchanged. Whisper API is resilient to amplitude variation
 *   in AAC, so Android recordings are transcribed reliably without normalization.
 *
 * The pipeline is always non-destructive: on any error it returns the original URI
 * so the translation pipeline never fails due to preprocessing.
 */

import { Platform } from 'react-native';

const FileSystem: any =
  Platform.OS === 'web'
    ? {
        readAsStringAsync: async () => '',
        writeAsStringAsync: async () => {},
        getInfoAsync: async () => ({ exists: true, size: 1 }),
        cacheDirectory: '',
      }
    : require('expo-file-system/legacy');

// ─── Constants ───────────────────────────────────────────────────────────────

const TARGET_RMS_DBFS = -20;          // Broadcast-speech loudness target
const SILENCE_THRESHOLD_DBFS = -40;   // Amplitude below this is considered silence
const SILENCE_PAD_SAMPLES = 800;      // Keep 50 ms of context around speech edges (at 16 kHz)
const MAX_GAIN_DB = 24;               // Cap amplification — don't boost noise floors

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Preprocess a recorded audio file for Whisper submission.
 * - iOS WAV: normalize to -20 dBFS RMS, strip leading/trailing silence
 * - Android m4a: returned as-is (AAC cannot be decoded in JS)
 * - Web: returned as-is
 * Never throws — returns original URI on any failure.
 */
export async function preprocessForWhisper(audioUri: string): Promise<string> {
  if (Platform.OS !== 'ios') {
    console.log(`[audioProcessor] ${Platform.OS}: skipping WAV preprocessing`);
    return audioUri;
  }

  try {
    const b64 = await FileSystem.readAsStringAsync(audioUri, { encoding: 'base64' });
    const bytes = base64ToUint8Array(b64);

    if (!isValidPcmWav(bytes)) {
      console.warn('[audioProcessor] Not a 16-bit PCM WAV — skipping');
      return audioUri;
    }

    const header = parseWavHeader(bytes);
    if (!header) {
      console.warn('[audioProcessor] Could not parse WAV header');
      return audioUri;
    }

    const { dataOffset, numSamples, sampleRate } = header;
    const samples = extractSamples(bytes, dataOffset, numSamples);

    // Step 1 — Normalize RMS to TARGET_RMS_DBFS
    const normalizedSamples = normalizeRms(samples, TARGET_RMS_DBFS, MAX_GAIN_DB);

    // Step 2 — Strip leading / trailing silence
    const trimmedSamples = stripSilence(
      normalizedSamples,
      SILENCE_THRESHOLD_DBFS,
      SILENCE_PAD_SAMPLES,
    );

    // Safety: if stripping removed too much, fall back to just normalization
    const minSamples = Math.floor(sampleRate * 0.3); // 300 ms minimum
    const finalSamples = trimmedSamples.length >= minSamples ? trimmedSamples : normalizedSamples;

    const outBytes = buildWav(finalSamples, sampleRate, 1, 16);
    const outB64 = uint8ArrayToBase64(outBytes);
    const outUri = `${FileSystem.cacheDirectory ?? ''}proc_${Date.now()}.wav`;
    await FileSystem.writeAsStringAsync(outUri, outB64, { encoding: 'base64' });

    const durationSec = (finalSamples.length / sampleRate).toFixed(2);
    const savedBytes = bytes.length - outBytes.length;
    console.log(
      `✅ [audioProcessor] ${bytes.length}B → ${outBytes.length}B ` +
      `(${durationSec}s, saved ${savedBytes}B silence)`,
    );

    return outUri;
  } catch (err) {
    console.warn('[audioProcessor] Preprocessing failed — using original audio:', err);
    return audioUri;
  }
}

// ─── WAV Parsing ─────────────────────────────────────────────────────────────

function isValidPcmWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false;
  // "RIFF" at 0, "WAVE" at 8
  if (
    bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45
  ) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const audioFormat = view.getUint16(20, true);
  const bitsPerSample = view.getUint16(34, true);
  const numChannels = view.getUint16(22, true);
  return audioFormat === 1 && bitsPerSample === 16 && numChannels === 1;
}

interface WavHeader {
  dataOffset: number;
  numSamples: number;
  sampleRate: number;
}

function parseWavHeader(bytes: Uint8Array): WavHeader | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const sampleRate = view.getUint32(24, true);

    // Scan for 'data' chunk — it may not always start at offset 36
    let dataOffset = 44;
    for (let i = 12; i < Math.min(bytes.length - 8, 2000); i++) {
      if (
        bytes[i] === 0x64 && bytes[i + 1] === 0x61 &&
        bytes[i + 2] === 0x74 && bytes[i + 3] === 0x61
      ) {
        const dataChunkSize = view.getUint32(i + 4, true);
        dataOffset = i + 8;
        const numSamples = Math.floor(dataChunkSize / 2);
        return { dataOffset, numSamples, sampleRate };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractSamples(bytes: Uint8Array, dataOffset: number, numSamples: number): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset + dataOffset);
  const available = Math.floor((bytes.length - dataOffset) / 2);
  const count = Math.min(numSamples, available);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

// ─── DSP ─────────────────────────────────────────────────────────────────────

function normalizeRms(samples: Int16Array, targetDbfs: number, maxGainDb: number): Int16Array {
  if (samples.length === 0) return samples;

  // Compute RMS
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / samples.length);

  if (rms < 1) {
    console.log('[audioProcessor] Near-silence input — skipping normalization');
    return samples;
  }

  const currentDbfs = 20 * Math.log10(rms / 32767);
  const gainDb = targetDbfs - currentDbfs;
  const gainLinear = Math.min(Math.pow(10, gainDb / 20), Math.pow(10, maxGainDb / 20));

  console.log(
    `[audioProcessor] RMS=${currentDbfs.toFixed(1)} dBFS  ` +
    `gain=${Math.min(gainDb, maxGainDb).toFixed(1)} dB  ` +
    `(cap=${maxGainDb} dB)`,
  );

  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * gainLinear)));
  }
  return out;
}

function stripSilence(
  samples: Int16Array,
  thresholdDbfs: number,
  padSamples: number,
): Int16Array {
  const threshold = 32767 * Math.pow(10, thresholdDbfs / 20); // ≈ 328 at -40 dBFS

  // Find first non-silent sample
  let firstVoice = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) { firstVoice = i; break; }
  }
  if (firstVoice === -1) {
    console.log('[audioProcessor] All-silence input — returning unchanged');
    return samples;
  }

  // Find last non-silent sample
  let lastVoice = firstVoice;
  for (let i = samples.length - 1; i >= firstVoice; i--) {
    if (Math.abs(samples[i]) > threshold) { lastVoice = i; break; }
  }

  const start = Math.max(0, firstVoice - padSamples);
  const end = Math.min(samples.length, lastVoice + padSamples + 1);
  return samples.slice(start, end);
}

// ─── WAV Writer ──────────────────────────────────────────────────────────────

function buildWav(
  samples: Int16Array,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number,
): Uint8Array {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const w8 = (o: number, v: number) => view.setUint8(o, v);
  const w16 = (o: number, v: number) => view.setUint16(o, v, true);
  const w32 = (o: number, v: number) => view.setUint32(o, v, true);

  // RIFF header
  [0x52,0x49,0x46,0x46].forEach((b, i) => w8(i, b));      // 'RIFF'
  w32(4, 36 + dataSize);
  [0x57,0x41,0x56,0x45].forEach((b, i) => w8(8 + i, b));  // 'WAVE'
  [0x66,0x6D,0x74,0x20].forEach((b, i) => w8(12 + i, b)); // 'fmt '
  w32(16, 16);                                              // Subchunk1Size
  w16(20, 1);                                               // PCM
  w16(22, numChannels);
  w32(24, sampleRate);
  w32(28, (sampleRate * numChannels * bitsPerSample) >>> 3);
  w16(32, (numChannels * bitsPerSample) >>> 3);             // BlockAlign
  w16(34, bitsPerSample);
  [0x64,0x61,0x74,0x61].forEach((b, i) => w8(36 + i, b)); // 'data'
  w32(40, dataSize);

  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }
  return new Uint8Array(buffer);
}

// ─── Base64 helpers ──────────────────────────────────────────────────────────

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Process in 8 KB chunks to avoid call-stack limits on large buffers
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(binary);
}
