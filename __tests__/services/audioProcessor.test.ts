import { Platform } from 'react-native';
import { preprocessForWhisper } from '@/services/audioProcessor';

const mockReadAsStringAsync = jest.fn();
const mockWriteAsStringAsync = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: (uri: string, options: unknown) => mockReadAsStringAsync(uri, options),
  writeAsStringAsync: (uri: string, contents: string, options: unknown) =>
    mockWriteAsStringAsync(uri, contents, options),
  getInfoAsync: async () => ({ exists: true, size: 1 }),
  cacheDirectory: 'file:///cache/',
}));

const SAMPLE_RATE = 16000;

/** Build a 16-bit mono PCM WAV, optionally with a filler chunk before `data`. */
function buildWav(
  samples: Int16Array,
  { sampleRate = SAMPLE_RATE, numChannels = 1, bitsPerSample = 16, extraChunk = false } = {},
): Uint8Array {
  const filler = extraChunk ? 12 : 0; // 'LIST' + size + 4 payload bytes
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + filler + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + filler + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * numChannels * bitsPerSample) >>> 3, true);
  view.setUint16(32, (numChannels * bitsPerSample) >>> 3, true);
  view.setUint16(34, bitsPerSample, true);
  if (extraChunk) {
    ascii(36, 'LIST');
    view.setUint32(40, 4, true);
  }
  ascii(36 + filler, 'data');
  view.setUint32(40 + filler, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + filler + i * 2, samples[i], true);
  }
  return new Uint8Array(buffer);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Read back the samples of a WAV the processor wrote (header is always 44 bytes). */
function readSamples(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset + 44);
  const count = Math.floor((bytes.length - 44) / 2);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

function rmsDbfs(samples: Int16Array): number {
  let sumSq = 0;
  for (const s of samples) sumSq += s * s;
  return 20 * Math.log10(Math.sqrt(sumSq / samples.length) / 32767);
}

/** `seconds` of a sine tone at the given peak amplitude. */
function tone(seconds: number, amplitude: number): Int16Array {
  const out = new Int16Array(Math.floor(SAMPLE_RATE * seconds));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE));
  }
  return out;
}

function concat(...parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** The base64 payload the processor handed to writeAsStringAsync. */
function writtenWav(): Uint8Array {
  return fromBase64(mockWriteAsStringAsync.mock.calls[0][1] as string);
}

describe('preprocessForWhisper', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    (Platform as { OS: string }).OS = 'ios';
    mockWriteAsStringAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = originalOS;
    jest.restoreAllMocks();
  });

  it.each(['android', 'web'])('skips preprocessing on %s and returns the original URI', async (os) => {
    (Platform as { OS: string }).OS = os;

    await expect(preprocessForWhisper('file:///rec.m4a')).resolves.toBe('file:///rec.m4a');
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
  });

  it('writes a processed WAV into the cache directory on iOS', async () => {
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(tone(1, 3000))));

    const result = await preprocessForWhisper('file:///rec.wav');

    expect(result).toMatch(/^file:\/\/\/cache\/proc_\d+\.wav$/);
    expect(mockWriteAsStringAsync).toHaveBeenCalledWith(result, expect.any(String), {
      encoding: 'base64',
    });
    expect(mockReadAsStringAsync).toHaveBeenCalledWith('file:///rec.wav', { encoding: 'base64' });
  });

  it('normalises a quiet recording up towards -20 dBFS', async () => {
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(tone(1, 800))));

    await preprocessForWhisper('file:///rec.wav');

    expect(rmsDbfs(readSamples(writtenWav()))).toBeCloseTo(-20, 0);
  });

  it('caps amplification so a near-silent noise floor is not boosted past the gain limit', async () => {
    const veryQuiet = tone(1, 20); // ≈ -67 dBFS RMS; a -20 dBFS target needs > 24 dB of gain
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(veryQuiet)));

    await preprocessForWhisper('file:///rec.wav');

    const gainApplied = rmsDbfs(readSamples(writtenWav())) - rmsDbfs(veryQuiet);
    expect(gainApplied).toBeLessThanOrEqual(24.5);
  });

  it('strips leading and trailing silence around speech', async () => {
    const silence = new Int16Array(SAMPLE_RATE); // 1s
    const speech = tone(1, 6000);
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(concat(silence, speech, silence))));

    await preprocessForWhisper('file:///rec.wav');
    const written = readSamples(writtenWav());

    expect(written.length).toBeGreaterThanOrEqual(speech.length);
    // 1s of speech + 50 ms of retained context on each edge, well under the 3s input
    expect(written.length).toBeLessThan(speech.length + SAMPLE_RATE * 0.2);
  });

  it('leaves an all-silence recording at its original length', async () => {
    const silence = new Int16Array(SAMPLE_RATE);
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(silence)));

    await preprocessForWhisper('file:///rec.wav');

    expect(readSamples(writtenWav()).length).toBe(silence.length);
  });

  it('keeps the normalised audio when silence stripping would leave under 300 ms', async () => {
    const blip = concat(new Int16Array(SAMPLE_RATE), tone(0.05, 6000), new Int16Array(SAMPLE_RATE));
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(blip)));

    await preprocessForWhisper('file:///rec.wav');

    expect(readSamples(writtenWav()).length).toBe(blip.length);
  });

  it('finds the data chunk when other chunks precede it', async () => {
    const speech = tone(1, 6000);
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(speech, { extraChunk: true })));

    await preprocessForWhisper('file:///rec.wav');

    expect(readSamples(writtenWav()).length).toBeGreaterThan(0);
  });

  it('preserves the source sample rate in the output header', async () => {
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(tone(1, 3000), { sampleRate: 44100 })));

    await preprocessForWhisper('file:///rec.wav');

    const header = new DataView(writtenWav().buffer);
    expect(header.getUint32(24, true)).toBe(44100);
    expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint16(34, true)).toBe(16);
  });

  it.each([
    ['stereo', { numChannels: 2 }],
    ['8-bit', { bitsPerSample: 8 }],
  ])('returns the original URI for %s input it cannot process', async (_label, options) => {
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(tone(0.5, 3000), options)));

    await expect(preprocessForWhisper('file:///rec.wav')).resolves.toBe('file:///rec.wav');
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
  });

  it('returns the original URI for non-WAV (compressed) input', async () => {
    mockReadAsStringAsync.mockResolvedValue(toBase64(new Uint8Array(200).fill(0x41)));

    await expect(preprocessForWhisper('file:///rec.m4a')).resolves.toBe('file:///rec.m4a');
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
  });

  it('returns the original URI when the file cannot be read', async () => {
    mockReadAsStringAsync.mockRejectedValue(new Error('ENOENT'));

    await expect(preprocessForWhisper('file:///missing.wav')).resolves.toBe('file:///missing.wav');
  });

  it('returns the original URI when the processed file cannot be written', async () => {
    mockReadAsStringAsync.mockResolvedValue(toBase64(buildWav(tone(1, 3000))));
    mockWriteAsStringAsync.mockRejectedValue(new Error('disk full'));

    await expect(preprocessForWhisper('file:///rec.wav')).resolves.toBe('file:///rec.wav');
  });
});
