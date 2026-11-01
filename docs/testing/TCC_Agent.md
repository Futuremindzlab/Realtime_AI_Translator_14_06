# TCC_Agent — Test Case Creation

## Role

Given the current state of the OneLingo codebase (and optionally a new bug
report), produce or update `test-case-catalog.md`: a complete, de-duplicated
list of test cases across every scenario class below, each one concrete
enough that TCE_Agent or a human can execute it without guessing.

TCC_Agent does not execute anything and does not judge pass/fail. It only
designs.

## Inputs

- The app code: `app/`, `services/`, `lib/`, `contexts/`, `backend/`.
- Existing coverage: `__tests__/`, `backend/__tests__/`, `docs/E2E_TESTING_CHECKLIST.md`.
- Any new bug report (treat each reported bug as a mandatory new regression
  test case — see "Regression rule" below).

## Scenario taxonomy (minimum categories to cover)

1. **Conversation turn pipeline** — record → transcribe → translate → TTS →
   playback, for both Person A and Person B, across language pairs
   (especially Indian-language pairs: Tamil↔English, Hindi↔English,
   Tamil↔Hindi — the detected-language confusion class).
2. **ASR/transcription edge cases** — silence, very short utterance (<1s),
   code-switched speech, background noise, low-confidence/garbled Whisper
   output (`lib/whisperHallucinations.ts` exists specifically for this —
   every known hallucination pattern it filters needs a case).
3. **Language detection** — Whisper's detected language vs. the user's
   configured `sourceLanguage`/`targetLanguage` disagreeing (the exact shape
   of the 2026-11-01 report: Tamil speech produced an English-tagged, 2-
   character transcript instead of a Tamil one).
4. **Translate stage** — provider fallback, empty/short input, very long
   input, rate-limit/5xx from the translation API.
5. **TTS stage** — each provider (OpenAI, ElevenLabs, Inworld, on-device
   `expo-speech`), each configured voice gender, provider fallback when the
   primary TTS call fails.
6. **App lifecycle** — background/foreground transitions *during* an active
   recording or an active turn (the log in the 2026-11-01 report shows
   `AppState changed` events interleaved with turn processing — this is a
   first-class scenario class, not an edge case).
7. **Permissions** — mic permission denied/revoked mid-session, storage
   permission for cached audio.
8. **Network conditions** — offline at turn start, network drop mid-turn,
   slow/high-latency network, invalid/expired API key.
9. **Billing (Razorpay)** — subscription purchase (card + UPI), webhook
   signature verification, price displayed vs. price charged
   (`lib/plans.ts` vs `backend/src/lib/razorpay.mjs` — already unit-tested,
   still needs a manual checkout case per `__tests__/README.md`).
10. **Auth (Cognito)** — sign up, duplicate email, wrong password, OTP,
    forgot-password, session persistence across app restart.
11. **OCR scan-translate** (`services/ocrTranslateService.ts`) — clear image,
    blurry/low-light image, unsupported script, no text detected.
12. **Android device variance** — OEM skins (Samsung/Xiaomi/OnePlus per
    `docs/E2E_TESTING_CHECKLIST.md` §0), fresh install vs. upgrade-over-
    previous-build, back button during active recording.

## Regression rule

Every bug reported against the running app (like the 2026-11-01 Tamil
Person A log) becomes a test case tagged `[REGRESSION]` with the report date
and a link to the fix PR once one exists — mirroring the convention already
used in `docs/E2E_TESTING_CHECKLIST.md`. Never let a reported bug go
untracked as a test case, even before it's fixed.

## Output format — one row per test case in `test-case-catalog.md`

| Field | Meaning |
|---|---|
| `ID` | Stable id, e.g. `TC-PIPE-014` |
| `Category` | One of the taxonomy sections above |
| `Mode` | `auto` (TCE_Agent can run it unattended) or `manual` (needs a real device/human) |
| `Preconditions` | State required before the steps |
| `Steps` | Numbered, concrete actions |
| `Expected result` | Observable, falsifiable outcome |
| `Regression of` | Bug report date/link, or blank |

Keep `auto` cases mapped 1:1 to an actual file+test name under `__tests__/`
or `backend/__tests__/` where one exists, so TCE_Agent can run exactly that
test rather than the whole suite when re-verifying one case.
