/**
 * Filters out Whisper's well-known hallucinated captions — root cause of the
 * "conversation mode announces 'Engine sound' out of nowhere" bug: Whisper
 * (both the OpenAI cloud API and the on-device whisper.cpp/whisper.rn model,
 * same underlying architecture) was trained on movie/YouTube-style captioned
 * data, and when given silence or plain ambient noise (a real engine, wind,
 * AC hum — anything crossing startRecordingWithAutoStop's -45dB "someone's
 * speaking" threshold, which is a loudness heuristic, not real voice-activity
 * detection) it frequently hallucinates a short caption-style non-speech
 * description instead of returning empty text: "Engine sound", "[Music]",
 * "(applause)", "Thanks for watching!", etc. Nothing upstream of this can
 * tell a real 2-word utterance from a hallucinated one — Whisper reports
 * equal confidence for both — so this is a text-level denylist rather than
 * a probability-based filter (OpenAI's whisper-1 API does expose per-segment
 * no_speech_prob/avg_logprob, but this app only calls it in `verbose_json`
 * and currently only reads back `.text`/`.language` — passing those numbers
 * through server round-trip for one filtering decision is more machinery
 * than a maintained phrase list needs).
 *
 * Only ever treated the same as "no speech was said" (see
 * RealtimeTranslationService.ts's two call sites) — never surfaced as its
 * own distinct error, since from the speaker's perspective nothing was
 * actually said, which is exactly true.
 */

// Exact phrases (after normalization below) that are pure Whisper filler —
// this list is deliberately short-and-common rather than exhaustive; add to
// it as new hallucinated phrases turn up rather than trying to enumerate
// every possible non-speech caption up front.
const HALLUCINATION_EXACT = new Set([
  'engine sound', 'engine sounds', 'engine noise', 'engine revving', 'engine running', 'car engine',
  'music', 'music playing', 'background music', 'upbeat music', 'instrumental music',
  'applause', 'laughter', 'laughing', 'crowd cheering', 'cheering',
  'silence', 'static', 'static noise', 'background noise', 'noise',
  'thank you', 'thank you.', 'thanks for watching', 'thank you for watching',
  'please subscribe', 'subscribe', 'like and subscribe', 'subscribe to my channel',
  'you', 'bye', 'bye bye',
]);

// A short phrase (≤4 words) that's built entirely around one of these nouns
// is almost certainly the same class of hallucinated sound-effect caption,
// even in wording not in the exact list above (e.g. "faint engine sound",
// "loud engine noise"). Anything longer is left alone — a real sentence that
// happens to mention an engine ("the engine sound was too loud to hear him")
// is plausible speech, not a hallucination, and MIN_WORDS_FOR_KEYWORD_MATCH
// keeps this from swallowing it.
const HALLUCINATION_KEYWORDS = /\b(engine|music|applause|laughter|static|background noise)\b/i;
const MAX_WORDS_FOR_KEYWORD_MATCH = 4;

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    // Whisper commonly wraps non-speech descriptions in brackets/parens —
    // "[Music]", "(engine sound)" — strip the wrapper before matching.
    .replace(/^[[(]+|[\])]+$/g, '')
    .replace(/[.!?]+$/g, '')
    .trim();
}

export function isLikelyWhisperHallucination(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  if (HALLUCINATION_EXACT.has(normalized)) return true;

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 0 && wordCount <= MAX_WORDS_FOR_KEYWORD_MATCH && HALLUCINATION_KEYWORDS.test(normalized)) {
    return true;
  }
  return false;
}
