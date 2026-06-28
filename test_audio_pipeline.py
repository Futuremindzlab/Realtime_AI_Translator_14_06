#!/usr/bin/env python3
"""
test_audio_pipeline.py
======================
Benchmarks the audio -> ASR pipeline for Malayalam, Hindi, Spanish, and English.

Tests per language:
  1. gTTS audio generation
  2. WAV conversion -> 16 kHz / 16-bit / mono PCM (via pydub or MP3 direct)
  3. RMS normalization to -20 dBFS
  4. VAD silence stripping
  5. OpenAI Whisper-1 transcription - three modes:
     a. auto-detect (no language param)
     b. explicit ISO code + prompt  (for supported languages: hi, ta, te, kn, es, en, ...)
     c. prompt-only (for Whisper-unsupported codes: ml, si, or, as, ne)
  6. WER (Word Error Rate, punctuation-normalized) against reference text
  7. Per-step latency

Usage:
    set EXPO_PUBLIC_OPENAI_API_KEY=sk-...
    py test_audio_pipeline.py
"""

from __future__ import annotations

import io
import json
import math
import os
import re
import sys
import time
import wave
from pathlib import Path
from typing import Optional

if sys.platform == "win32":
    import io as _io
    sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

_missing: list[str] = []
try:
    import numpy as np
except ImportError:
    _missing.append("numpy")

try:
    from openai import OpenAI
except ImportError:
    _missing.append("openai")

try:
    from gtts import gTTS
except ImportError:
    _missing.append("gtts")

try:
    from jiwer import wer as _jiwer_wer
    def compute_wer(ref: str, hyp: str) -> float:
        return float(_jiwer_wer(ref, hyp))
except ImportError:
    _missing.append("jiwer")
    def compute_wer(ref: str, hyp: str) -> float:  # type: ignore[misc]
        return -1.0

if _missing:
    print(f"[ERROR] Missing packages: {', '.join(_missing)}")
    print(f"  Run:  py -m pip install {' '.join(_missing)} "
          "--trusted-host pypi.org --trusted-host files.pythonhosted.org")
    sys.exit(1)

# ── Test cases ────────────────────────────────────────────────────────────────

# WHISPER_PROMPT_ONLY_LANGS: codes that cause HTTP 400 when passed as language=
# Must match the same set in services/openaiService.ts
WHISPER_PROMPT_ONLY_LANGS = {"ml", "si", "or", "as", "ne"}

TEST_CASES = [
    {
        "lang": "ml",
        "name": "Malayalam",
        "gtts_lang": "ml",
        "reference": "ഇന്ന് കാലാവസ്ഥ വളരെ നല്ലതാണ്",
        "whisper_prompt": "ഇത് മലയാളം ഭാഷയിലുള്ള ഒരു ഓഡിയോ ആണ്.",
    },
    {
        "lang": "hi",
        "name": "Hindi",
        "gtts_lang": "hi",
        "reference": "आज मौसम बहुत अच्छा है",
        "whisper_prompt": "यह हिंदी भाषा में एक ऑडियो है।",
    },
    {
        "lang": "es",
        "name": "Spanish",
        "gtts_lang": "es",
        "reference": "El tiempo es muy bueno hoy",
        "whisper_prompt": None,
    },
    {
        "lang": "en",
        "name": "English",
        "gtts_lang": "en",
        "reference": "The weather is very nice today",
        "whisper_prompt": None,
    },
]

# ── Audio DSP helpers ─────────────────────────────────────────────────────────

TARGET_RMS_DBFS = -20.0
SILENCE_DBFS    = -40.0
SILENCE_PAD_MS  = 50
MAX_GAIN_DB     = 24.0
SAMPLE_RATE     = 16_000


def mp3_bytes_to_pcm(mp3_bytes: bytes) -> np.ndarray:
    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_file(io.BytesIO(mp3_bytes), format="mp3")
        seg = seg.set_channels(1).set_frame_rate(SAMPLE_RATE).set_sample_width(2)
        return np.frombuffer(seg.raw_data, dtype=np.int16)
    except Exception:
        return np.array([], dtype=np.int16)


def normalize_rms(pcm: np.ndarray, target: float = TARGET_RMS_DBFS,
                  max_gain: float = MAX_GAIN_DB) -> tuple[np.ndarray, dict]:
    if pcm.size == 0:
        return pcm, {"rms_before_dbfs": None, "rms_after_dbfs": None, "gain_applied_db": 0}
    pcm_f = pcm.astype(np.float64)
    rms = math.sqrt(float(np.mean(pcm_f ** 2)))
    if rms < 1.0:
        return pcm, {"rms_before_dbfs": -96, "rms_after_dbfs": -96, "gain_applied_db": 0}
    rms_db  = 20 * math.log10(rms / 32767)
    gain_db = min(target - rms_db, max_gain)
    out = np.clip(pcm_f * (10 ** (gain_db / 20)), -32768, 32767).astype(np.int16)
    rms2   = math.sqrt(float(np.mean(out.astype(np.float64) ** 2)))
    rms2_db = 20 * math.log10(max(rms2, 1) / 32767)
    return out, {"rms_before_dbfs": round(rms_db, 1), "rms_after_dbfs": round(rms2_db, 1),
                 "gain_applied_db": round(gain_db, 1)}


def strip_silence(pcm: np.ndarray, sr: int = SAMPLE_RATE,
                  threshold_dbfs: float = SILENCE_DBFS,
                  pad_ms: int = SILENCE_PAD_MS) -> tuple[np.ndarray, dict]:
    if pcm.size == 0:
        return pcm, {"trimmed_ms": 0, "voice_ms": 0}
    threshold = 32767 * (10 ** (threshold_dbfs / 20))
    pad_smp   = int(sr * pad_ms / 1000)
    nonsilent = np.where(np.abs(pcm.astype(np.float64)) > threshold)[0]
    if nonsilent.size == 0:
        return pcm, {"trimmed_ms": 0, "voice_ms": 0}
    start = max(0, int(nonsilent[0]) - pad_smp)
    end   = min(len(pcm), int(nonsilent[-1]) + pad_smp + 1)
    trimmed    = pcm[start:end]
    orig_ms    = round(len(pcm) / sr * 1000)
    voice_ms   = round(len(trimmed) / sr * 1000)
    return trimmed, {"trimmed_ms": orig_ms - voice_ms, "voice_ms": voice_ms}


def pcm_to_wav_bytes(pcm: np.ndarray, sr: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def normalize_text(text: str) -> str:
    """Strip trailing punctuation and extra whitespace for WER comparison."""
    text = text.strip()
    text = re.sub(r'[।\.!?,;:]+$', '', text)  # strip trailing Indian/Latin punct
    return text.strip()


# ── Whisper helpers ───────────────────────────────────────────────────────────

def whisper_transcribe(
    client: OpenAI,
    audio_bytes: bytes,
    filename: str,
    lang_code: Optional[str],
    prompt: Optional[str],
) -> tuple[str, str, float]:
    t0 = time.perf_counter()
    kwargs: dict = dict(
        model="whisper-1",
        file=(filename, audio_bytes, "audio/wav"),
        response_format="verbose_json",
        temperature=0,
    )
    if lang_code:
        kwargs["language"] = lang_code
    if prompt:
        kwargs["prompt"] = prompt
    resp    = client.audio.transcriptions.create(**kwargs)
    latency = time.perf_counter() - t0
    text    = (resp.text or "").strip()
    detected = getattr(resp, "language", "?") or "?"
    return text, detected, round(latency, 3)


# ── Main benchmark ────────────────────────────────────────────────────────────

def run_pipeline(api_key: str, out_dir: Path) -> list[dict]:
    client  = OpenAI(api_key=api_key)
    results = []

    print("\n" + "=" * 82)
    print("  REALTIME AI TRANSLATOR -- AUDIO PIPELINE BENCHMARK")
    print("=" * 82)
    print(f"{'Language':<12} {'Mode':<18} {'WER':>6} {'Detected':<12} "
          f"{'Latency':>9} {'RMS->dBFS':>10} {'Trim ms':>8}")
    print("-" * 82)

    for tc in TEST_CASES:
        lang   = tc["lang"]
        name   = tc["name"]
        ref    = tc["reference"]
        prompt = tc["whisper_prompt"]
        is_prompt_only = lang in WHISPER_PROMPT_ONLY_LANGS

        # ── 1. gTTS audio ─────────────────────────────────────────────────────
        try:
            mp3_buf = io.BytesIO()
            gTTS(text=ref, lang=tc["gtts_lang"], slow=False).write_to_fp(mp3_buf)
            mp3_bytes = mp3_buf.getvalue()
        except Exception as e:
            print(f"  WARNING: gTTS failed for {name}: {e}")
            continue

        # ── 2. Decode MP3 -> 16 kHz PCM ───────────────────────────────────────
        pcm_raw = mp3_bytes_to_pcm(mp3_bytes)
        has_pcm = pcm_raw.size > 0

        # ── 3. Normalize + VAD ────────────────────────────────────────────────
        dsp_stats: dict = {}
        if has_pcm:
            pcm_norm, norm_stats = normalize_rms(pcm_raw)
            pcm_trim, vad_stats  = strip_silence(pcm_norm)
            dsp_stats = {**norm_stats, **vad_stats}
            final_pcm = pcm_trim if pcm_trim.size > 0 else pcm_norm
            wav_bytes = pcm_to_wav_bytes(final_pcm)
            (out_dir / f"{lang}_processed.wav").write_bytes(wav_bytes)
        else:
            # No ffmpeg — send MP3 directly (Whisper accepts it)
            wav_bytes = mp3_bytes
            dsp_stats = {"rms_before_dbfs": "N/A", "rms_after_dbfs": "N/A",
                         "gain_applied_db": 0, "trimmed_ms": 0}
            (out_dir / f"{lang}_processed.mp3").write_bytes(wav_bytes)

        rms_note = (f"{dsp_stats.get('rms_before_dbfs','N/A')}->"
                    f"{dsp_stats.get('rms_after_dbfs','N/A')} dB")
        trim     = dsp_stats.get("trimmed_ms", 0)

        # ── 4a. AUTO-DETECT ───────────────────────────────────────────────────
        try:
            text_auto, det_auto, lat_auto = whisper_transcribe(
                client, wav_bytes, f"{lang}.wav", None, None)
            wer_auto = compute_wer(normalize_text(ref), normalize_text(text_auto))
        except Exception as e:
            text_auto, det_auto, lat_auto, wer_auto = f"ERROR: {e}", "?", 0.0, 1.0

        ws = f"{wer_auto:.1%}" if wer_auto >= 0 else "N/A"
        print(f"  {name:<12} {'auto':<18} {ws:>6} {det_auto:<12} "
              f"{lat_auto:>8.2f}s {rms_note:>10} {trim:>7}ms")

        results.append({"language": name, "lang_code": lang, "mode": "auto",
                        "reference": ref, "hypothesis": text_auto,
                        "detected": det_auto,
                        "wer": round(wer_auto, 4) if wer_auto >= 0 else None,
                        "latency_s": lat_auto, **dsp_stats})

        # ── 4b. EXPLICIT / PROMPT-ONLY ────────────────────────────────────────
        # For Whisper-unsupported language codes (ml, si, etc.) we omit the
        # language param to avoid HTTP 400, but still pass the script-seed prompt.
        # This matches the fix applied in services/openaiService.ts.
        explicit_lang = None if is_prompt_only else lang
        mode_label    = "prompt-only" if is_prompt_only else "explicit+prompt"

        try:
            text_exp, det_exp, lat_exp = whisper_transcribe(
                client, wav_bytes, f"{lang}.wav", explicit_lang, prompt)
            wer_exp = compute_wer(normalize_text(ref), normalize_text(text_exp))
        except Exception as e:
            text_exp, det_exp, lat_exp, wer_exp = f"ERROR: {e}", "?", 0.0, 1.0

        ws2 = f"{wer_exp:.1%}" if wer_exp >= 0 else "N/A"
        print(f"  {'':<12} {mode_label:<18} {ws2:>6} {det_exp:<12} "
              f"{lat_exp:>8.2f}s {'':>10} {'':>7}  ")

        results.append({"language": name, "lang_code": lang, "mode": mode_label,
                        "reference": ref, "hypothesis": text_exp,
                        "detected": det_exp,
                        "wer": round(wer_exp, 4) if wer_exp >= 0 else None,
                        "latency_s": lat_exp, **dsp_stats})

        print(f"    Ref:      {ref}")
        print(f"    Auto:     {text_auto}")
        print(f"    {mode_label}: {text_exp}")
        print()

    print("=" * 82)
    return results


def print_summary(results: list[dict]) -> None:
    langs = dict.fromkeys(r["language"] for r in results)
    print("\n  SUMMARY -- WER comparison (punctuation-normalized)")
    print(f"  {'Language':<12} {'Auto WER':>9} {'Fixed WER':>11} {'Delta':>8}  Mode")
    print("  " + "-" * 52)
    for lang in langs:
        rows    = [r for r in results if r["language"] == lang]
        auto_r  = next((r for r in rows if r["mode"] == "auto"), None)
        fix_r   = next((r for r in rows if r["mode"] != "auto"), None)
        if not auto_r or not fix_r:
            continue
        aw = auto_r["wer"]
        ew = fix_r["wer"]
        if aw is not None and ew is not None:
            delta = ew - aw
            sign  = "+" if delta > 0 else ""
            print(f"  {lang:<12} {aw:>8.1%} {ew:>10.1%}  {sign}{delta:>6.1%}  {fix_r['mode']}")
        else:
            print(f"  {lang:<12} {'N/A':>9} {'N/A':>11}  {fix_r['mode'] if fix_r else ''}")
    print()


if __name__ == "__main__":
    api_key = (
        os.environ.get("EXPO_PUBLIC_OPENAI_API_KEY") or
        os.environ.get("OPENAI_API_KEY")
    )
    if not api_key:
        env_file = Path(__file__).parent / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.startswith("EXPO_PUBLIC_OPENAI_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break

    if not api_key:
        print("[ERROR] OpenAI API key not found.")
        print("  Set EXPO_PUBLIC_OPENAI_API_KEY=sk-... or add it to .env")
        sys.exit(1)

    out_dir = Path(__file__).parent / "test_audio_output"
    out_dir.mkdir(exist_ok=True)
    print(f"Audio output dir: {out_dir}")

    results = run_pipeline(api_key, out_dir)
    print_summary(results)

    out_json = out_dir / "benchmark_results.json"
    out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Full results saved to: {out_json}\n")
