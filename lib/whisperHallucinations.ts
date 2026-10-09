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
// Deliberately excludes plausible real conversational speech — 'thank you',
// 'bye', and bare 'you' used to be on this list and caused real false
// positives (reported: a user spoke clearly in a silent room and still got
// "No input — passing to the other person"). Those three are exactly the
// kind of short thing people actually say in a real conversation, unlike
// everything below, none of which has any real chance of being genuine
// speech in this app's context (a live two-person conversation, not a
// YouTube video). Only non-speech caption artifacts and phrases with no
// plausible conversational reading belong in this set.
const HALLUCINATION_EXACT = new Set([
  'engine sound', 'engine sounds', 'engine noise', 'engine revving', 'engine running', 'car engine',
  'music', 'music playing', 'background music', 'upbeat music', 'instrumental music',
  'applause', 'laughter', 'laughing', 'crowd cheering', 'cheering',
  'silence', 'static', 'static noise', 'background noise', 'noise',
  'thanks for watching', 'thank you for watching',
  'please subscribe', 'subscribe', 'like and subscribe', 'subscribe to my channel',
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

// A completely different Whisper failure mode from the caption-style
// hallucinations above, hit in production on a Malayalam conversation: the
// decoder gets stuck and repeats the same short word/phrase over and over —
// "അന്നു അന്നു അന്നു..." transcribed, "that day that day that day..."
// translated. Not a fixed phrase in any one language (unlike
// HALLUCINATION_EXACT), so it needs a structural check instead of a
// denylist entry: does the SAME 1-, 2-, or 3-word block repeat back-to-back
// enough times that it's clearly a stuck loop rather than someone actually
// repeating a word for emphasis ("no no no" is plausible speech; the same
// word 4+ times in a row, or a 2-3 word phrase 3+ times, isn't).
//
// Checked as non-overlapping consecutive blocks (words split into chunks of
// size n, each compared to the one before) rather than a sliding window —
// simpler, and this only needs to catch a block repeating immediately after
// itself, not a repeated phrase reappearing later in otherwise-real speech.
const MIN_BLOCK_REPEATS: Record<number, number> = { 1: 4, 2: 3, 3: 3 };

function longestConsecutiveBlockRepeat(words: string[], blockSize: number): number {
  if (words.length < blockSize * 2) return 1;
  let maxRun = 1;
  let run = 1;
  for (let i = blockSize; i + blockSize <= words.length; i += blockSize) {
    const prevBlock = words.slice(i - blockSize, i).join(' ');
    const currBlock = words.slice(i, i + blockSize).join(' ');
    if (prevBlock === currBlock) {
      run++;
      if (run > maxRun) maxRun = run;
    } else {
      run = 1;
    }
  }
  return maxRun;
}

function hasRepeatingLoop(normalized: string): boolean {
  const words = normalized.split(/\s+/).filter(Boolean);
  for (const blockSize of [1, 2, 3]) {
    if (longestConsecutiveBlockRepeat(words, blockSize) >= MIN_BLOCK_REPEATS[blockSize]) {
      return true;
    }
  }
  return false;
}

/** Which specific rule flagged the text, or null if none did — see classifyWhisperHallucination. */
export type WhisperHallucinationMatch = 'exact' | 'keyword' | 'repeating-loop' | null;

/**
 * Same classification as isLikelyWhisperHallucination, but names which rule
 * fired instead of collapsing to a boolean. Added after a real transcript
 * (detectedLanguage populated, 39 chars — not silence) still got discarded
 * as "No speech detected": the diagnostics log only ever recorded the
 * transcript's *length*, never which check rejected it or why, so a false
 * positive here was indistinguishable from genuine silence after the fact.
 * Callers that need to log a reason use this; isLikelyWhisperHallucination
 * stays the simple boolean check for everything else (including the
 * existing test suite).
 */
export function classifyWhisperHallucination(text: string): WhisperHallucinationMatch {
  const normalized = normalize(text);
  if (!normalized) return null;
  if (HALLUCINATION_EXACT.has(normalized)) return 'exact';

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 0 && wordCount <= MAX_WORDS_FOR_KEYWORD_MATCH && HALLUCINATION_KEYWORDS.test(normalized)) {
    return 'keyword';
  }

  if (hasRepeatingLoop(normalized)) return 'repeating-loop';

  return null;
}

export function isLikelyWhisperHallucination(text: string): boolean {
  return classifyWhisperHallucination(text) !== null;
}

// Characters a transcript can consist entirely of and still count as "no
// real speech" — stray punctuation/symbols Whisper sometimes emits on pure
// silence or a mic click, not anything a person said.
const PUNCTUATION_ONLY = /^[\s.,!?;:…\-–—*"'“”‘’(){}\[\]~`^_|\\/]*$/;

/**
 * Root cause of a real false-positive report (user spoke clearly in a quiet
 * room, got "No input — passing to the other person" anyway): callers used
 * to reject any transcript under 3 characters as "no speech". That's a
 * reasonable-looking guard against stray punctuation, but it also discards
 * genuine short utterances — "Hi", "No", "OK" in English, and single- or
 * double-character complete words in many other languages (CJK especially:
 * "是"/"不"/"好" are each one character and a full, meaningful reply). A
 * length threshold can't tell those apart from noise; only content can.
 * This checks content instead: empty after trimming, or made up entirely of
 * punctuation/whitespace, counts as no speech — anything with real
 * character content, however short, does not.
 */
export function hasNoSpeechContent(text: string): boolean {
  return PUNCTUATION_ONLY.test(text);
}
