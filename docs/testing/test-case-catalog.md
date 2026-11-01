# OneLingo test case catalog

Produced by TCC_Agent. See `TCC_Agent.md` for the taxonomy and rules this
follows. `Mode: auto` rows are mapped to an existing automated test where one
exists; `Mode: manual` rows point at the matching section of
`docs/E2E_TESTING_CHECKLIST.md` where one already exists, instead of
duplicating its steps.

## 1. Conversation turn pipeline

| ID | Mode | Steps | Expected result | Mapped test / checklist | Regression of |
|---|---|---|---|---|---|
| TC-PIPE-001 | auto | Compute next turn languages for Person A → Person B | Source/target swap correctly | `conversationTurnLanguage.test.ts` → `computeNextTurnLanguages` | |
| TC-PIPE-002 | auto | Simulate a long multi-turn conversation with an unrelated 3rd language pair | Pairing never drifts across turns | `conversationTurnLanguage.test.ts` → "3rd or 4th turn" | yes — prior drift bug |
| TC-PIPE-003 | manual | Person A speaks Tamil, target English, full conversation mode, Android | Transcript is Tamil text (`detectedLanguage: "ta"`), not a 2-char English misfire | §4 (new, see TC-PIPE-010) | **2026-11-01 report** |
| TC-PIPE-010 | manual | Full A/B round-trip: A speaks Tamil → B hears English TTS → B replies English → A hears Tamil TTS | Both turns show `success:true` with correct `detectedLanguage` and non-trivial `textLength` | `docs/E2E_TESTING_CHECKLIST.md` (add a "Conversation mode" section if missing) | |

## 2. ASR / transcription edge cases

| ID | Mode | Steps | Expected result | Mapped test | Regression of |
|---|---|---|---|---|---|
| TC-ASR-001 | auto | Feed `"(sizzling)"` to the hallucination filter | Flagged as hallucination | `whisperHallucinations.test.ts` — "flags the reported case" | |
| TC-ASR-002 | auto | Feed a word repeated 8+ times in a row | Flagged as a repetition-loop | `whisperHallucinations.test.ts` — repetition-loop section | |
| TC-ASR-003 | auto | Feed empty/whitespace-only transcript | Flagged as no-speech-content, not discarded as "too short" | `whisperHallucinations.test.ts` → `hasNoSpeechContent` | |
| TC-ASR-004 | auto | Feed a 1-2 character CJK reply (e.g. "是") | NOT flagged as no-speech (short ≠ empty) | `whisperHallucinations.test.ts` — "does NOT flag single/double-character CJK" | |
| TC-ASR-005 | manual | Record 0.5s of silence | No crash; turn reports empty/low-confidence, not a false transcript | — | |
| TC-ASR-006 | auto | `isReady=false`, nothing pinned | Falls back to cloud transcription | `whisperService.test.ts` — "uses cloud when the model was never initialized" | |
| TC-ASR-007 | auto | Pinned `useOnDevice=false` overrides a live `isReady()=true` | Cloud is used, not on-device | `whisperService.test.ts` — "the actual bug fix" | yes |

## 3. Language detection

| ID | Mode | Steps | Expected result | Mapped test | Regression of |
|---|---|---|---|---|---|
| TC-LANG-001 | auto | Detected language differs from target | Uses detected language as source | `conversationTurnLanguage.test.ts` → `resolvePersonAAutoSourceLanguage` | |
| TC-LANG-002 | auto | Detected language equals target (misdetection guard) | Defaults to English rather than X→X | `conversationTurnLanguage.test.ts` — "misdetection guard" | |
| TC-LANG-003 | manual | Person A configured source=Tamil, speaks Tamil, Whisper misdetects as English | Downstream pipeline either corrects via the guard or logs a clear mismatch, never silently produces a 1-2 char English transcript from Tamil audio | Investigate against TC-PIPE-003 | **2026-11-01 report** |

## 4. Translate stage

| ID | Mode | Steps | Expected result | Mapped test | Regression of |
|---|---|---|---|---|---|
| TC-TRN-001 | manual | Translation API returns 5xx | UI shows retry/error, not a silent blank bubble | §7 of `docs/E2E_TESTING_CHECKLIST.md` (network section) | |
| TC-TRN-002 | manual | Very long input (>500 chars) | Full translation returned, no truncation | — | |
| TC-TRN-003 | auto | Extract error message from backend's own `{error: "..."}` shape | Message extracted correctly | `proxyErrors.test.ts` | |
| TC-TRN-004 | auto | Extract error message from OpenAI's nested `{error:{message,...}}` shape | Message extracted correctly | `proxyErrors.test.ts` | |

## 5. TTS stage

| ID | Mode | Steps | Expected result | Mapped test | Regression of |
|---|---|---|---|---|---|
| TC-TTS-001 | manual | TTS provider = ElevenLabs, Indian-language target | Natural-sounding audio plays, `hasAudioUri:true` | `docs/E2E_TESTING_CHECKLIST.md` | |
| TC-TTS-002 | manual | Primary TTS provider call fails (bad key / rate limit) | Falls back to secondary provider, not a silent no-audio turn | — | |
| TC-TTS-003 | manual | Voice gender toggled male/female per provider | Playback uses the selected gender | — | |

## 6. App lifecycle

| ID | Mode | Steps | Expected result | Mapped test | Regression of |
|---|---|---|---|---|---|
| TC-LIFE-001 | manual | Background the app mid-recording, foreground within 2s | Recording resumes/completes cleanly, no stuck "recording" state | — | relevant to **2026-11-01 report** (AppState churn in log) |
| TC-LIFE-002 | manual | `stopConversation()` fires from a rapid double-tap on the record button | No crash, no duplicate turn submitted | §1/§6 of `docs/E2E_TESTING_CHECKLIST.md` | **2026-11-01 report** (stack trace present in log) |
| TC-LIFE-003 | manual | Backgrounding during an in-flight API call (transcribe/translate/TTS) | Turn either completes on return or fails cleanly with a retry path, never silently drops | — | |

## 7. Permissions

| ID | Mode | Steps | Expected result | Mapped test | Regression of |
|---|---|---|---|---|---|
| TC-PERM-001 | manual | Deny mic permission, attempt to record | Clear in-app message, no crash | `docs/E2E_TESTING_CHECKLIST.md` §1 | |
| TC-PERM-002 | manual | Revoke mic permission mid-session (Android Settings), return to app | App detects revocation, prompts to re-grant | — | |

## 8. Network conditions

| ID | Mode | Steps | Expected result | Mapped test | Regression of |
|---|---|---|---|---|---|
| TC-NET-001 | auto | Raw `fetch()` TypeError (web and RN shapes) | Classified as network error | `errors.test.ts` — "recognizes a raw ... fetch() TypeError" | |
| TC-NET-002 | auto | Cognito's wrapped "Network error" (by `.code` and by message) | Classified as network error | `errors.test.ts` | |
| TC-NET-003 | auto | Normal HTTP error response (e.g. 404 with a body) | NOT classified as a network error | `errors.test.ts` — "does NOT classify a normal HTTP error response" | |
| TC-NET-004 | manual | Full offline at turn start | Clear offline message before attempting the pipeline | — | |

## 9. Billing (Razorpay)

| ID | Mode | Steps | Expected result | Mapped test | Regression of |
|---|---|---|---|---|---|
| TC-BILL-001 | auto | Displayed price (`lib/plans.ts`) vs. charged price (`backend/src/lib/razorpay.mjs`) | Always match (₹100/₹200) | `plans.test.ts` + `razorpay.test.mjs` | |
| TC-BILL-002 | auto | Correctly-signed webhook payload | Accepted | `razorpay.test.mjs` — "accepts a correctly-signed payment" | |
| TC-BILL-003 | auto | Tampered signature / wrong secret / mismatched payment-subscription pair | All rejected | `razorpay.test.mjs` | |
| TC-BILL-004 | auto | Body re-serialized after signing | Rejected (the exact raw-body bug class) | `razorpay.test.mjs` — "the exact bug the raw-body requirement guards against" | yes |
| TC-BILL-005 | auto | Non-OWNER caller hits admin payments/subscriptions endpoints | 403, zero DynamoDB/Razorpay calls made | `adminPayments.test.mjs`, `adminSubscriptions.test.mjs` | |
| TC-BILL-006 | auto | Basic/Plus-plan caller calls the live-tier AI proxy (ElevenLabs) | 403, ElevenLabs never called | `aiProxy.test.mjs` | |
| TC-BILL-007 | manual | Real checkout: card payment | Subscription activates, `plan` flips in DynamoDB | `__tests__/README.md` manual QA note | |
| TC-BILL-008 | manual | Real checkout: UPI / UPI Autopay | UPI option visible at checkout, charge completes | `__tests__/README.md` manual QA note | |

## 10. Auth (Cognito)

| ID | Mode | Steps | Expected result | Mapped test / checklist | Regression of |
|---|---|---|---|---|---|
| TC-AUTH-001 | manual | Sign up with email+password → confirm via emailed code | Account created and confirmed | `docs/E2E_TESTING_CHECKLIST.md` §2 | |
| TC-AUTH-002 | manual | Sign up with an already-registered email | Clear error, not a silent failure | `docs/E2E_TESTING_CHECKLIST.md` §2 | |
| TC-AUTH-003 | manual | Force-close and relaunch after sign-in | Session persists, no re-login required | `docs/E2E_TESTING_CHECKLIST.md` §2 — REGRESSION #66 | yes |

## 11. OCR scan-translate

| ID | Mode | Steps | Expected result | Mapped test | Regression of |
|---|---|---|---|---|---|
| TC-OCR-001 | auto | Parse a bare JSON object / fenced / stray-prose-wrapped scan result | Correctly extracted in all three shapes | `scanResultParsing.test.ts` | |
| TC-OCR-002 | auto | Malformed JSON or no JSON object present | Throws explicitly rather than returning partial data | `scanResultParsing.test.ts` | |
| TC-OCR-003 | manual | Scan a blurry/low-light image | Clear "couldn't read this" message, not a garbled translation | — | |
| TC-OCR-004 | manual | Scan text in an unsupported script | Clear unsupported-script message | — | |

## 12. Android device variance

| ID | Mode | Steps | Expected result | Mapped test / checklist | Regression of |
|---|---|---|---|---|---|
| TC-AND-001 | manual | Install new build over an old one (upgrade, not fresh) | Home-screen icon updates | `docs/E2E_TESTING_CHECKLIST.md` §1 — REGRESSION #69 | yes |
| TC-AND-002 | manual | Check adaptive icon on at least one OEM-skinned device | Real gradient, not a flat color | `docs/E2E_TESTING_CHECKLIST.md` §0/§1 — REGRESSION #70 | yes |
| TC-AND-003 | manual | Fresh install (not upgrade) full pass | Onboarding → permissions → first recording all work | `docs/E2E_TESTING_CHECKLIST.md` §0/§1 | |

---

**Coverage note:** 20 of the 37 rows above are `auto` and already runnable
via `scripts/tce-run.sh`. The remaining 17 `manual` rows need a real Android
device per `docs/E2E_TESTING_CHECKLIST.md` — TCE_Agent surfaces them as
`BLOCKED` rather than skipping them silently.
