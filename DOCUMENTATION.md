# Documentation — TTS Provider Notes & Phone/OTP Auth

This file covers two additions to the app: **TTS provider fixes/options for Malayalam** and **Phone + OTP login**. For the full architecture (STT/translation/TTS pipeline, existing Cognito email/password flow, DynamoDB schema, etc.), see [docs/TECHNICAL.md](docs/TECHNICAL.md) — this document only covers what's new.

---

## 1. Why this was needed

Malayalam speech quality remained poor even after prior STT/routing fixes. Initial investigation suspected ElevenLabs had no native Malayalam voice, but further research showed that's incorrect — ElevenLabs' `eleven_v3` model genuinely supports Malayalam natively. **The real bug**: `services/ttsService.ts`'s ElevenLabs error handling treated HTTP 401 as always meaning "invalid API key," but ElevenLabs also returns 401 for "quota exceeded" (distinguished only by a field in the response body) — so once the free-tier monthly character quota ran out, the app misdiagnosed it as a bad key and silently disabled ElevenLabs for the rest of the session, falling back to lower-quality OpenAI/device TTS. That's now fixed (`generateWithElevenLabs`'s `callAPI`, ~line 576) — quota errors only fail that one request instead of disabling the provider. **ElevenLabs (with an active subscription/quota headroom) remains the default/preferred engine for Malayalam.**

Azure Cognitive Speech (native `ml-IN-SobhanaNeural` / `ml-IN-MidhunNeural` voices) was also built out as a **manually-selectable alternative provider** in Settings, but is **not auto-preferred** — it's there if you want to compare quality or have an Azure subscription already, not as the primary fix.

---

## 2. Azure Speech (optional, manual provider only)

| Variable | Used by | Required |
|---|---|---|
| `EXPO_PUBLIC_AZURE_SPEECH_KEY` | Azure TTS (manual selection only) | Optional — feature has no effect if unset |
| `EXPO_PUBLIC_AZURE_SPEECH_REGION` | Azure TTS region (e.g. `centralindia`, `eastus`) | Optional, required alongside the key above |

To use it: in the [Azure Portal](https://portal.azure.com), create a **Speech** resource, confirm the region hosts `ml-IN-*` neural voices via the [Azure Speech Studio voice gallery](https://speech.microsoft.com/portal/voicegallery), and put the key/region in `.env`. Users then select "Azure Speech" manually in Settings. No backend changes needed — called directly from the client (`services/ttsService.ts`), same pattern as OpenAI/ElevenLabs.

### Voice coverage

| Language | Female | Male |
|---|---|---|
| Malayalam (`ml`) | `ml-IN-SobhanaNeural` | `ml-IN-MidhunNeural` |

Only Malayalam has a mapped voice today (`AZURE_VOICE_MAP` in `services/ttsService.ts`). If a user selects Azure as their provider and translates into any other language, it falls back to ElevenLabs/OpenAI/device automatically (no mapped voice → caught error → fallback chain).

---

## 4. Phone + OTP login

**Status: deployed and verified end-to-end in production (`ai-translator-stack`, pool `us-east-1_ZcvBPWVo2`) as of 2026-07-05.**

Passwordless sign-in using Cognito's **Custom Authentication Flow** + AWS SNS for SMS delivery. Reuses the existing user pool — no new pool created.

### Why this needed more than "3 Lambda triggers"

The pool has `UsernameAttributes: ['email']` and `email` marked `Required: true` — **both immutable, set at pool creation and unchangeable afterward** (confirmed via `describe-user-pool`; `AliasAttributes` also can't be added post-creation, ruling out a phone alias). This means:
- Cognito can only look a user up by an email-shaped `Username` — never by raw phone number.
- Auto-provisioning a brand-new user *inside* `CreateAuthChallenge` via `request.userNotFound` is not a safe pattern here: once Cognito flags a session as `userNotFound`, it may treat the whole session as a user-enumeration-prevention decoy that never issues real tokens, even if you create a real user mid-flow. AWS's own guidance is to create the user in a **separate step before** `initiateAuth`, so `userNotFound` is always `false`.
- `AdminCreateUser` always leaves new users in `FORCE_CHANGE_PASSWORD` status, which makes `InitiateAuth` return `NEW_PASSWORD_REQUIRED` *before* it ever reaches the custom OTP challenge — blocking passwordless sign-in unless fixed.
- The app client's `ExplicitAuthFlows` didn't include `ALLOW_CUSTOM_AUTH` at all — `CUSTOM_AUTH` fails outright without it.

All four were discovered and fixed during deployment (see below) — they weren't apparent from reading the Cognito trigger docs alone.

### How it actually works

1. User picks a country code + enters their number; the client composes an E.164 number (e.g. `+919876543210`) for UX only.
2. `AuthContext.signInWithPhone()` first calls **`POST /v1/auth/phone/request-otp`** (unauthenticated route, handled by `backend/src/handlers/phoneAuth.mjs`'s `requestPhoneOtp`, added to the existing `TranslatorFunction` router):
   - Re-validates/normalizes the phone server-side via `backend/src/phone.mjs` (`toE164`) — never trusts client formatting.
   - Derives a deterministic, non-deliverable placeholder Username via `derivePhoneUsername()` (e.g. `phone-919876543210@phone-user.realtimeaitranslator.internal`) — this exists purely to satisfy the pool's email-shaped-Username/required-email constraints; it's never seen by the user.
   - Looks the user up by `phone_number` via `ListUsers` (their real Cognito Username is unpredictable — a random `sub`-derived value from the very first `AdminCreateUser` call — so lookup must go through the phone attribute, not Username).
   - If not found: `AdminCreateUser` (phone_number + phone_number_verified, `MessageAction: SUPPRESS`) followed immediately by `AdminSetUserPassword(..., Permanent: true)` with a random, never-shared password, to avoid the `FORCE_CHANGE_PASSWORD`/`NEW_PASSWORD_REQUIRED` trap above.
   - Returns `{ username }` — the client uses this (not the phone number) as `Username` for `initiateAuth`.
3. `AuthContext.signInWithPhone()` then calls Cognito `initiateAuth` with `AuthFlow=CUSTOM_AUTH` and `Username=<the returned username>`. Since the user now always already exists, `request.userNotFound` is always `false`.
4. Cognito invokes 3 Lambda triggers in sequence:
   - `DefineAuthChallenge` — pure state machine; issues a `CUSTOM_CHALLENGE`, then tokens after 1 correct answer or fails after 3 attempts.
   - `CreateAuthChallenge` — generates a 6-digit code and sends it via **AWS SNS** (re-sends the same code, via `challengeMetadata`, on a re-prompt rather than issuing a new one each attempt).
   - `VerifyAuthChallengeResponse` — compares the submitted code.
5. On success, the app receives normal Cognito tokens — same session handling as email/password.

### Deploy steps actually run (for reference — already applied to this stack)

```bash
cd backend && npm install && sam build && sam deploy --resolve-s3

# Wire the 3 Lambda triggers AND resupply the pool's full existing config
# (update-user-pool does not merge — omitted fields can reset existing settings,
# e.g. omitting AutoVerifiedAttributes broke UserAttributeUpdateSettings validation
# on the first attempt here). Always describe-user-pool first and pass everything
# through via --cli-input-json rather than shorthand flags for a production pool.
aws cognito-idp update-user-pool --cli-input-json file://update_pool.json --region us-east-1

# Enable CUSTOM_AUTH on the app client — NOT enabled by default, and missing
# entirely blocks phone sign-in with "CUSTOM_AUTH is not enabled for the client."
# Same non-merging caution applies — resupply the full client config.
aws cognito-idp update-user-pool-client --cli-input-json file://update_client.json --region us-east-1

# Grant Cognito permission to invoke each trigger (SAM doesn't auto-grant this
# since the pool isn't a CFN-managed trigger source):
aws lambda add-permission --function-name ai-translator-define-auth-prod \
  --principal cognito-idp.amazonaws.com \
  --source-arn arn:aws:cognito-idp:us-east-1:326246079892:userpool/us-east-1_ZcvBPWVo2 \
  --action lambda:InvokeFunction --statement-id CognitoInvokeDefine
# ...same for ai-translator-create-auth-prod (CognitoInvokeCreate) and
# ai-translator-verify-auth-prod (CognitoInvokeVerify)
```

Verified end-to-end via `admin-initiate-auth`/`admin-respond-to-auth-challenge` with a test number: challenge issuance, wrong-code rejection (re-challenges rather than erroring), and clean SNS publish all confirmed working before wiring was considered done. Test users were deleted afterward.

### ⚠️ SNS / DLT caveat for Indian (+91) numbers

Sending OTP SMS to **Indian phone numbers via AWS SNS requires DLT (Distributed Ledger Technology) template registration** with Indian telecom regulators (TRAI). This is an **account-level registration you must complete yourself** — it's out of scope for this code change. Until it's done, `sns:Publish` returns success but carriers may silently drop the SMS to +91 numbers. Non-Indian numbers (+1, +44, etc.) are unaffected.

### New backend dependencies

`backend/package.json` now also includes `@aws-sdk/client-sns` and `@aws-sdk/client-cognito-identity-provider`.

---

## 5. Files touched

| File | Change |
|---|---|
| `services/ttsService.ts` | Azure provider, voice map, `generateWithAzure`, fallback-chain routing |
| `app/(tabs)/index.tsx`, `app/(tabs)/history.tsx` | Read `EXPO_PUBLIC_AZURE_SPEECH_KEY`/`_REGION`, call `initializeAzure` |
| `app/(tabs)/settings.tsx` | Azure provider radio option; phone/OTP sign-in UI |
| `types/index.ts` | `tts_provider` union includes `'azure'` |
| `backend/src/handlers/settings.mjs` | `VALID_PROVIDERS` includes `'azure'` |
| `backend/src/phone.mjs` | E.164 validation/normalization + `derivePhoneUsername` |
| `backend/src/handlers/phoneAuth.mjs` | `requestPhoneOtp` — pre-provisioning endpoint (`POST /v1/auth/phone/request-otp`) |
| `backend/src/handlers/defineAuthChallenge.mjs`, `createAuthChallenge.mjs`, `verifyAuthChallengeResponse.mjs` | Cognito custom-auth Lambda triggers |
| `backend/src/index.mjs` | Routes `POST /v1/auth/phone/request-otp` to `requestPhoneOtp` |
| `backend/template.yaml` | 3 new trigger functions, 2 new unauthenticated API events on `TranslatorFunction`, `SnsPublishPolicy`, `CognitoAdminPolicy` (attached to `TranslatorFunction`), 3 new Outputs |
| `backend/package.json` | `@aws-sdk/client-sns`, `@aws-sdk/client-cognito-identity-provider` |
| `contexts/AuthContext.tsx` | `signInWithPhone`, `confirmOtpCode`, `needsOtpVerification`, `pendingPhone` |
| `components/CountryCodeSelector.tsx` | New — country code picker for phone entry |
| `.env` | New Azure env var placeholders |
