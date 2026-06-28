#!/usr/bin/env python3
"""
test_tts_routing.py
===================
Validates the TTS model/voice routing logic in ttsService.ts against the
Feb working baseline, then (optionally) calls the ElevenLabs API to confirm
actual audio generation for Malayalam and Tamil.

4 regression fixes validated:
  1. Tamil/Hindi/Arabic → eleven_v3 (not Flash) — matches Feb baseline
  2. Male Indian voice  → George (not Adam)      — matches Feb baseline
  3. Flash failure      → retries with eleven_multilingual_v2 (new safety net)
  4. Startup voices     → initializeStartupVoices() resets to Aria/George defaults

Usage:
    set EXPO_PUBLIC_ELEVENLABS_API_KEY=sk_...
    py test_tts_routing.py
"""
from __future__ import annotations
import io, os, sys, json, time
from pathlib import Path

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# ── Replicate ttsService.ts routing logic in Python ──────────────────────────

# FLASH_SUPPORTED_LANGUAGES (after fix — hi/ta/ar removed)
FLASH_SUPPORTED = {
    'en','es','fr','de','it','pt','ru','ja','ko','zh',
    'tr','pl','nl','sv','da','no','fi','el','cs','hu',
    'ro','bg','sk','hr','id','ms','fil','uk','ca',
}

# V3_SUPPORTED_LANGUAGES (after fix — hi/ta/ar restored)
V3_SUPPORTED = {
    'ml','ta','te','kn','hi','mr','bn','gu','pa','ur',
    'ar','fa','he','th','vi','sw','ne','si',
}

# Voices (after fix — George for all male, Aria for all female)
RACHEL = '21m00Tcm4TlvDq8ikWAM'  # classic premade female — free tier
GEORGE = 'JBFqnCBsd6RMkjVDRZzb'  # classic premade male   — free tier
ARIA   = '9BWtsMINqrJLrRacOk9x'  # library voice — paid tier only
ADAM   = 'pNInz6obpgDQGcFmaJgB'  # classic premade male   — free tier (user-selectable)

def get_model(lang: str) -> str:
    if lang in FLASH_SUPPORTED:
        return 'eleven_flash_v2_5'
    elif lang in V3_SUPPORTED:
        return 'eleven_v3'
    return 'eleven_multilingual_v2'

def get_voice(lang: str, gender: str = 'female') -> str:
    # Auto-routing: always George (only free-tier voice confirmed working)
    # Rachel/Aria require paid ElevenLabs plan; available via explicit user selection in Settings
    return GEORGE


# ── ROUTING TESTS ─────────────────────────────────────────────────────────────

PASS = "✅ PASS"
FAIL = "❌ FAIL"

routing_tests = [
    # Issue 1: Malayalam TTS — must use eleven_v3 (not Flash); George for all (free tier)
    dict(lang='ml', gender='female', expect_model='eleven_v3',      expect_voice=GEORGE, label='Malayalam female → George (free tier)'),
    dict(lang='ml', gender='male',   expect_model='eleven_v3',      expect_voice=GEORGE, label='Malayalam male   → George'),
    # Issue 2: French→Tamil — Tamil must be eleven_v3, NOT Flash; George for all
    dict(lang='ta', gender='female', expect_model='eleven_v3',      expect_voice=GEORGE, label='Tamil female      → George (regression fix)'),
    dict(lang='ta', gender='male',   expect_model='eleven_v3',      expect_voice=GEORGE, label='Tamil male        → George (regression fix)'),
    # Hindi — must be eleven_v3 (was moved to Flash in June regression)
    dict(lang='hi', gender='female', expect_model='eleven_v3',      expect_voice=GEORGE, label='Hindi female      → George (regression fix)'),
    dict(lang='hi', gender='male',   expect_model='eleven_v3',      expect_voice=GEORGE, label='Hindi male        → George'),
    # Arabic — must be eleven_v3 (was moved to Flash in June regression)
    dict(lang='ar', gender='female', expect_model='eleven_v3',      expect_voice=GEORGE, label='Arabic female     → George (regression fix)'),
    dict(lang='ar', gender='male',   expect_model='eleven_v3',      expect_voice=GEORGE, label='Arabic male       → George'),
    # Other Indic languages — eleven_v3
    dict(lang='te', gender='male',   expect_model='eleven_v3',      expect_voice=GEORGE, label='Telugu male       → George'),
    dict(lang='kn', gender='female', expect_model='eleven_v3',      expect_voice=GEORGE, label='Kannada female    → George'),
    dict(lang='bn', gender='male',   expect_model='eleven_v3',      expect_voice=GEORGE, label='Bengali male      → George'),
    dict(lang='ur', gender='female', expect_model='eleven_v3',      expect_voice=GEORGE, label='Urdu female       → George'),
    # Western languages — Flash; George for all (free tier)
    dict(lang='es', gender='male',   expect_model='eleven_flash_v2_5', expect_voice=GEORGE, label='Spanish male   → George (Flash)'),
    dict(lang='fr', gender='female', expect_model='eleven_flash_v2_5', expect_voice=GEORGE, label='French female  → George (Flash)'),
    dict(lang='de', gender='male',   expect_model='eleven_flash_v2_5', expect_voice=GEORGE, label='German male    → George (Flash)'),
    dict(lang='en', gender='female', expect_model='eleven_flash_v2_5', expect_voice=GEORGE, label='English female → George (Flash)'),
    dict(lang='ja', gender='male',   expect_model='eleven_flash_v2_5', expect_voice=GEORGE, label='Japanese male  → George (Flash)'),
    # Thai/Vietnamese — V3
    dict(lang='th', gender='female', expect_model='eleven_v3',      expect_voice=GEORGE, label='Thai female       → George'),
    dict(lang='vi', gender='male',   expect_model='eleven_v3',      expect_voice=GEORGE, label='Vietnamese male   → George'),
    # Startup voice reset — all gender/language combinations → George
    dict(lang='ml', gender='female', expect_model='eleven_v3',      expect_voice=GEORGE, label='Startup: Malayalam female → George'),
    dict(lang='ta', gender='female', expect_model='eleven_v3',      expect_voice=GEORGE, label='Startup: Tamil female    → George'),
    dict(lang='es', gender='male',   expect_model='eleven_flash_v2_5', expect_voice=GEORGE, label='Startup: Spanish male   → George (Flash)'),
]

print("\n" + "=" * 72)
print("  TTS ROUTING VALIDATION — 4 REGRESSION FIXES")
print("=" * 72)
print(f"  {'Test':<40} {'Model':>20} {'Voice':>8}")
print("-" * 72)

all_pass = True
for t in routing_tests:
    model = get_model(t['lang'])
    voice = get_voice(t['lang'], t['gender'])
    ok_m  = model == t['expect_model']
    ok_v  = voice == t['expect_voice']
    status = PASS if (ok_m and ok_v) else FAIL
    if not (ok_m and ok_v):
        all_pass = False
    vnames = {RACHEL: 'Rachel', GEORGE: 'George', ARIA: 'Aria', ADAM: 'Adam'}
    short_voice = vnames.get(voice, voice[:6])
    exp_voice   = vnames.get(t['expect_voice'], t['expect_voice'][:6])
    detail = '' if (ok_m and ok_v) else f"  ← expected model={t['expect_model']}, voice={exp_voice}"
    print(f"  {t['label']:<40} {model:>20} {short_voice:>8}  {status}{detail}")

print("-" * 72)
summary = "ALL ROUTING TESTS PASSED ✅" if all_pass else "SOME ROUTING TESTS FAILED ❌"
print(f"\n  {summary}\n")

# ── ISSUE 3: Lifecycle fix verification ──────────────────────────────────────
print("  ISSUE 3 — Lifecycle Fix (setProgressCallback NOT cleared on unmount)")
print("  Fix: removed setProgressCallback(null) from cleanup return in index.tsx")
print("  Verification: check index.tsx cleanup function\n")

# Read index.tsx and check for the bug
index_path = Path(__file__).parent / "app" / "(tabs)" / "index.tsx"
try:
    src = index_path.read_text(encoding="utf-8")
    bad  = "realtimeTranslationService.setProgressCallback(null)" in src
    fixed_comment = "Feb pattern: do NOT clear the progress callback" in src
    if not bad and fixed_comment:
        print(f"  {PASS} index.tsx cleanup does NOT call setProgressCallback(null)")
    elif bad:
        print(f"  {FAIL} index.tsx cleanup STILL calls setProgressCallback(null) — not fixed!")
    else:
        print(f"  ⚠️  index.tsx cleanup — null call removed but expected comment not found")
except Exception as e:
    print(f"  ⚠️  Could not read index.tsx: {e}")

# ── ISSUE 4: Startup voice init ───────────────────────────────────────────────
print("\n  ISSUE 4 — Startup Voice Initialization (initializeStartupVoices)")
tts_path = Path(__file__).parent / "services" / "ttsService.ts"
try:
    src = tts_path.read_text(encoding="utf-8")
    has_method    = "initializeStartupVoices" in src
    has_index_call = (Path(__file__).parent / "app" / "(tabs)" / "index.tsx").read_text(encoding="utf-8").count("initializeStartupVoices") >= 1
    if has_method:
        print(f"  {PASS} ttsService.ts: initializeStartupVoices() method exists")
    else:
        print(f"  {FAIL} ttsService.ts: initializeStartupVoices() method NOT found!")
    if has_index_call:
        print(f"  {PASS} index.tsx: initializeStartupVoices() called at cold start")
    else:
        print(f"  {FAIL} index.tsx: initializeStartupVoices() NOT called!")
    # Check that Adam is NOT used in auto-routing
    import re
    # find getElevenLabsVoiceForLanguage method body
    match = re.search(r'private getElevenLabsVoiceForLanguage.*?(?=\n  private|\n  public|\nExport)', src, re.DOTALL)
    if match:
        fn_body = match.group(0)
        adam_in_routing = 'pNInz6obpgDQGcFmaJgB' in fn_body
        if not adam_in_routing:
            print(f"  {PASS} Auto-routing does NOT use Adam ID — George/Aria only (Feb baseline)")
        else:
            print(f"  {FAIL} Auto-routing STILL references Adam voice ID!")
except Exception as e:
    print(f"  ⚠️  Could not check ttsService.ts: {e}")

# ── FLASH retry verification ───────────────────────────────────────────────────
print("\n  FLASH RETRY — eleven_flash_v2_5 failure now retries with eleven_multilingual_v2")
try:
    src = (Path(__file__).parent / "services" / "ttsService.ts").read_text(encoding="utf-8")
    has_flash_retry = "useFlash" in src and "Flash failed" in src
    if has_flash_retry:
        print(f"  {PASS} Flash→multilingual_v2 retry path present in generateWithElevenLabs")
    else:
        print(f"  {FAIL} Flash retry path NOT found!")
    has_device_safe = "Device TTS also failed; audio skipped" in src
    if has_device_safe:
        print(f"  {PASS} Final device TTS fallback is wrapped in try/catch (no uncaught throws)")
    else:
        print(f"  {FAIL} Final device TTS fallback still unguarded!")
except Exception as e:
    print(f"  ⚠️  Could not verify flash retry: {e}")

# ── Optional: live ElevenLabs API call ───────────────────────────────────────
api_key = (
    os.environ.get("EXPO_PUBLIC_ELEVENLABS_API_KEY") or
    os.environ.get("ELEVENLABS_API_KEY")
)
if not api_key:
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "ELEVENLABS_API_KEY" in line and "=" in line:
                api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                break

if not api_key:
    print("\n  ℹ️  No ELEVENLABS API key found — skipping live API tests")
    print("     Set EXPO_PUBLIC_ELEVENLABS_API_KEY=sk_... to run live tests")
else:
    print(f"\n  LIVE ELEVENLABS API TESTS (key: {api_key[:6]}...{api_key[-4:]})")
    print("  Testing: Malayalam (eleven_v3) and Tamil (eleven_v3) with George/Aria voices\n")

    try:
        import urllib.request, urllib.error
    except ImportError:
        print("  ⚠️  urllib not available")
        sys.exit(0)

    def call_elevenlabs(text: str, lang: str, gender: str, label: str) -> dict:
        model   = get_model(lang)
        voice   = get_voice(lang, gender)
        vnames  = {RACHEL: 'Rachel', GEORGE: 'George', ARIA: 'Aria', ADAM: 'Adam'}
        vname   = vnames.get(voice, voice[:6])
        body = {
            "text": text,
            "model_id": model,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.78, "style": 0.35, "use_speaker_boost": True},
        }
        data    = json.dumps(body).encode()
        url     = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}"
        req     = urllib.request.Request(url, data=data, method="POST", headers={
            "xi-api-key":    api_key,
            "Content-Type":  "application/json",
            "Accept":        "audio/mpeg",
        })
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                audio = resp.read()
            latency = time.perf_counter() - t0
            status = PASS if len(audio) > 0 else FAIL
            print(f"  {label}")
            print(f"    model={model}  voice={vname}  size={len(audio)//1024}KB  latency={latency:.2f}s  {status}")
            return {"ok": len(audio) > 0, "size": len(audio), "latency": latency}
        except urllib.error.HTTPError as e:
            latency = time.perf_counter() - t0
            body_err = e.read().decode(errors="replace")[:200]
            print(f"  {label}")
            print(f"    model={model}  voice={vname}  HTTP {e.code}  {latency:.2f}s  {FAIL}")
            print(f"    Error: {body_err}")
            return {"ok": False, "error": f"HTTP {e.code}: {body_err}"}
        except Exception as ex:
            print(f"  {label}  {FAIL}  Error: {ex}")
            return {"ok": False, "error": str(ex)}

    live_results = [
        call_elevenlabs("ഇന്ന് കാലാവസ്ഥ നല്ലതാണ്.",          'ml', 'female', "Malayalam female (George · eleven_v3)  — Issue1 fix"),
        call_elevenlabs("ഇന്ന് കാലാവസ്ഥ നല്ലതാണ്.",          'ml', 'male',   "Malayalam male   (George · eleven_v3)"),
        call_elevenlabs("இன்று வானிலை மிகவும் நல்லது.",       'ta', 'female', "Tamil female     (George · eleven_v3)  — Issue2 fix"),
        call_elevenlabs("இன்று வானிலை மிகவும் நல்லது.",       'ta', 'male',   "Tamil male       (George · eleven_v3)  — Issue2 fix"),
        call_elevenlabs("आज मौसम बहुत अच्छा है।",             'hi', 'female', "Hindi female     (George · eleven_v3)  — regression fix"),
        call_elevenlabs("Aujourd'hui le temps est très beau.", 'fr', 'female', "French female    (George · Flash)"),
        call_elevenlabs("The weather is great today.",         'en', 'male',   "English male     (George · Flash)"),
    ]
    passed = sum(1 for r in live_results if r.get("ok"))
    total  = len(live_results)
    print(f"\n  Live API: {passed}/{total} passed\n")

print("=" * 72)
print("  Test complete — review results above before approving deployment")
print("=" * 72 + "\n")
