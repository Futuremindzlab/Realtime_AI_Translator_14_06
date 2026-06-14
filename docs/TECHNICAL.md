# Realtime AI Translator — Technical Reference

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   React Native / Expo (TypeScript)          │
│   Expo Router (file-based navigation)                       │
│   Tabs: Home · History · Dashboard (OWNER) · Settings      │
└──────────┬──────────────────────────────────────┬──────────┘
           │ Auth (amazon-cognito-identity-js)     │ API calls (fetch)
           ▼                                       ▼
┌──────────────────────┐            ┌──────────────────────────┐
│  AWS Cognito         │            │  AWS API Gateway (prod)  │
│  User Pool           │            │  + Lambda (Node 20)      │
│  us-east-1_ZcvBPWVo2 │            │  /v1/translations        │
│  USER_SRP_AUTH flow  │            │  /v1/settings            │
└──────────────────────┘            └────────────┬─────────────┘
                                                 │ SDK calls
                                                 ▼
                                    ┌──────────────────────────┐
                                    │  AWS DynamoDB            │
                                    │  conversation_history    │
                                    │  user_settings           │
                                    └──────────────────────────┘

On-device (no network required):
  whisper.rn  ── ggml-tiny.bin (~39 MB, downloaded once)
  expo-speech ── device TTS engine (iOS AVSpeech / Android TTS)
  AsyncStorage── translation cache (30-day TTL)

Cloud AI:
  OpenAI Whisper ─── cloud STT fallback
  OpenAI GPT-4o-mini ── translation (streaming SSE)
  OpenAI TTS-1 ─────── voice synthesis
  ElevenLabs ───────── premium voice synthesis (flash v2.5 / v3)
```

---

## End-to-End Execution Flow

Each translation cycle goes through these stages:

```
1. RECORD      AudioService.startRecording()
               expo-av records WAV at 16 kHz mono
               Auto-stop on 2.5s silence (min 1.5s, max 10s)

2. TRANSCRIBE  WhisperService.transcribeWithFallback(audioUri, language)
               ├── Primary: whisper.rn (on-device, ggml-tiny)
               │   └── If result is empty → fall through to cloud
               └── Fallback: OpenAI Whisper API (multipart/form-data POST)

3. TRANSLATE   translationCache.getCachedTranslation(src, tgt, text)
               ├── Cache HIT → return immediately (zero latency)
               └── Cache MISS → translationProvider.translate()
                   ├── Stream: OpenAI GPT-4o-mini via SSE (react-native-sse)
                   │   └── onChunk callback updates UI progressively
                   └── Fallback: plain fetch POST if SSE fails

4. SYNTHESISE  TTSService.generateSpeech(text, language, provider)
               ├── 'device' → expo-speech (zero latency, no API cost)
               ├── 'openai' → OpenAI TTS-1 (mp3, saved to cache dir)
               │   └── Auto-upgrade to ElevenLabs for Indian/Arabic/Thai
               └── 'elevenlabs'
                   ├── eleven_flash_v2_5 for Western/CJK (~75ms)
                   └── eleven_v3 for Indian/Arabic/Thai/Hebrew

5. PLAY        AudioService.playAudio(fileUri)
               expo-av Audio.Sound.createAsync → playAsync
               (Web: creates object URL from blob instead of file)

6. SAVE        DynamoService.saveTranslation(history)
               POST /v1/translations via API Gateway + Lambda
               Only saved when user is signed in
```

---

## AI Tools and Models

| Stage | Tool / Model | Latency | Notes |
|---|---|---|---|
| STT (on-device) | `whisper.rn` ggml-tiny | 0.5–2s | No network, ~39 MB model |
| STT (cloud fallback) | OpenAI `whisper-1` | 1–4s | multipart POST, better accuracy |
| Translation | OpenAI `gpt-4o-mini` | 1–3s streaming | SSE stream; plain fetch fallback |
| Translation cache | AsyncStorage | ~0ms | 30-day TTL, keyed by lang pair + text prefix |
| TTS (device) | `expo-speech` | ~0ms | iOS/Android system voice, no API key |
| TTS (OpenAI) | `tts-1` | 1–2s | 6 voices: alloy, echo, fable, onyx, nova, shimmer |
| TTS (ElevenLabs Flash) | `eleven_flash_v2_5` | ~75ms | Western/CJK languages |
| TTS (ElevenLabs v3) | `eleven_v3` | 1–2s | Indian, Arabic, Thai, Hebrew — only model that supports these correctly |
| Voice cloning | ElevenLabs Instant Voice Cloning | 15–30s (one-time) | 30–60s of audio required |

---

## Authentication

- **Library**: `amazon-cognito-identity-js`
- **Flow**: `USER_SRP_AUTH` (Secure Remote Password — default, no extra Cognito config needed)
- **Storage bridge**: `cognitoStorage` in `lib/aws.ts` — wraps AsyncStorage with an in-memory write-through cache so Cognito's synchronous `getItem` calls work correctly
- **Session restore**: on app launch, `userPool.getCurrentUser().getSession()` restores the session from the storage cache
- **Roles**: `OWNER` (admin) vs `USER` (standard) — sourced from `cognito:groups` claim in the Cognito JWT
- **Offline mode**: when `EXPO_PUBLIC_AWS_*` env vars are missing, `userPool` is null and the app runs as `OFFLINE_USER` (always `OWNER` role)

---

## Data Storage

| Store | What | TTL |
|---|---|---|
| DynamoDB `conversation_history` | Translation records | 30 days (TTL field) |
| DynamoDB `user_settings` | Per-user preferences | Permanent |
| AsyncStorage `tc:<src>:<tgt>:<prefix>` | Translation cache | 30 days |
| AsyncStorage `@rbac_view_mode` | Admin/user view preference | Permanent |
| `expo-file-system` cacheDirectory | TTS audio files (mp3) | Until cache cleared |
| In-memory (Cognito) | Auth session tokens | Session lifetime |

---

## Latency Profile

| Stage | Typical range | Optimisation |
|---|---|---|
| Record | 1.5–10s (user-controlled) | Auto-stop on 2.5s silence |
| On-device STT | 0.5–2s | Pre-init at app launch (`whisperService.initialize()`) |
| Cloud STT fallback | 1–4s | Only triggered on empty on-device result |
| Translation (cache hit) | ~0ms | 30-day AsyncStorage cache |
| Translation (streaming) | 0.5–3s | SSE stream; first token typically < 1s |
| TTS (device) | ~0ms | `expo-speech` — best choice for latency |
| TTS (ElevenLabs Flash) | ~75ms | Used automatically for Western/CJK languages |
| TTS (OpenAI) | 1–2s | Used for Western languages when ElevenLabs unavailable |
| Audio playback start | ~0ms | expo-av |

**Total typical cycle (happy path, device TTS, warm cache):** 1–4 seconds  
**Total typical cycle (all cloud, cold cache):** 4–10 seconds

---

## Offline-First Strategy

The app is designed to function without internet:

1. **On-device STT**: Whisper tiny model is downloaded to `documentDirectory` at first launch and cached permanently. `whisperService.initialize()` is called from `app/_layout.tsx` as a background task so the model is ready before the user first taps Record.

2. **Translation cache**: Every unique translation is stored in AsyncStorage with a 30-day TTL. Returning users translating common phrases get instant results.

3. **Device TTS**: `expo-speech` is the default TTS provider for new users. It uses the phone's built-in voice engine with zero latency and zero API cost. Users can upgrade to OpenAI or ElevenLabs in Settings.

4. **Graceful degradation**: if no API keys are configured, the app falls back:
   - STT: on-device Whisper only (no cloud fallback)
   - Translation: cache-only (fails with clear error if cache miss)
   - TTS: device voice automatically (`ttsService` detects missing keys and falls back)

---

## Key Files

| File | Responsibility |
|---|---|
| `app/(tabs)/index.tsx` | Home screen — mic button, language pickers, progress display |
| `app/(tabs)/settings.tsx` | Auth (sign in/up/out), preferences, voice picker, voice cloning |
| `app/(tabs)/history.tsx` | Translation history list |
| `app/(tabs)/stats.tsx` | Dashboard (OWNER only) |
| `app/_layout.tsx` | Root layout — initialises Whisper model at launch |
| `contexts/AuthContext.tsx` | Cognito auth state, settings load/save, role extraction |
| `services/RealtimeTranslationService.ts` | Main translation orchestration — record → transcribe → translate → TTS → play |
| `services/audioService.ts` | expo-av recording and playback |
| `services/whisperService.ts` | On-device Whisper STT + cloud fallback |
| `services/ttsService.ts` | TTS dispatch — OpenAI / ElevenLabs / device, auto-upgrade logic |
| `services/translationProvider.ts` | OpenAI translation (web version, includes @xenova/transformers) |
| `services/translationProvider.native.ts` | OpenAI translation (native — no WASM dependency) |
| `services/translationCache.ts` | AsyncStorage cache for translations |
| `services/dynamoService.ts` | HTTP client for API Gateway /v1/* endpoints |
| `lib/aws.ts` | Cognito User Pool initialisation, AsyncStorage bridge |
| `backend/template.yaml` | SAM CloudFormation template — Lambda, API Gateway, DynamoDB |
| `backend/src/handlers/translations.mjs` | Lambda handler for translation history CRUD |
| `backend/src/auth.mjs` | Lambda auth helper — extracts role from Cognito JWT |

---

## Environment Variables

All variables are prefixed `EXPO_PUBLIC_` so Expo Metro bakes them into the JS bundle at build time.

| Variable | Used by | Required |
|---|---|---|
| `EXPO_PUBLIC_OPENAI_API_KEY` | Whisper STT, GPT-4o-mini translation, OpenAI TTS | Yes |
| `EXPO_PUBLIC_ELEVENLABS_API_KEY` | ElevenLabs TTS, Voice Cloning | Optional |
| `EXPO_PUBLIC_AWS_REGION` | Cognito, API Gateway | Yes |
| `EXPO_PUBLIC_AWS_USER_POOL_ID` | Cognito auth | Yes |
| `EXPO_PUBLIC_AWS_USER_POOL_CLIENT_ID` | Cognito auth | Yes |
| `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID` | AWS Identity Pool (future use) | Optional |
| `EXPO_PUBLIC_API_BASE_URL` | API Gateway base URL for history and settings | Yes |

> For a build without cloud features (local demo), only `EXPO_PUBLIC_OPENAI_API_KEY` is strictly required. The app will use device TTS and on-device STT for everything else.

---

## Local Development Setup

```bash
# Prerequisites: Node 20+, npm 10+

# 1. Clone and install
git clone https://github.com/Mohanasundaram86/Realtime_AI_Translator_25_02_V1.git
cd Realtime_AI_Translator_25_02_V1
npm install

# 2. Create .env with your keys (copy from .env.example or set manually)
cp .env.example .env   # then edit .env

# 3. Start the dev server
npx expo start --dev-client   # native (requires a dev build on device)
npx expo start --web          # browser

# 4. Deploy backend (AWS SAM, needs aws CLI configured)
cd backend
sam build && sam deploy --resolve-s3
```

### Building the Android APK

```bash
# One-time: create EAS project
eas login
eas init

# Build APK in cloud (~15 min)
eas build --profile preview --platform android

# Or trigger via GitHub Actions: push to master branch
```

### Backend deployment (GitHub Actions)

Push to `master` automatically triggers:
1. `deploy-backend.yml` — SAM build + deploy to `ai-translator-stack`
2. `build-apk.yml` — EAS build of Android APK (downloadable from Actions artifacts)

Required GitHub Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `EXPO_TOKEN`, and all `EXPO_PUBLIC_*` variables.
