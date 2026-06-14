# Realtime Modern AI Translator — v25.02 (Offline-First)

> **Branch from:** `Realtime_AI_Translator_01_28_v1`
> **Created:** 2026-02-25
> **Key changes:** On-device Whisper STT (whisper.rn tiny model), device TTS via expo-speech, AsyncStorage translation cache, WAV 16 kHz recording format.

A full-stack mobile application built with React Native and Expo that provides realtime audio translation with minimal latency. This version reduces round-trip latency by running speech-to-text on-device (whisper.rn), caching repeated translations locally, and offering a zero-latency device TTS option via expo-speech — while keeping cloud OpenAI APIs as fallbacks for STT and as the primary translation engine.

## Quick Start (5 Minutes)

**Before using the app, you need:**
1. An OpenAI API key from https://platform.openai.com/api-keys
2. AWS credentials (Cognito User Pool + DynamoDB) configured in `.env`
3. A device with a working microphone

**First-time setup:**
1. Copy `.env.example` to `.env` and fill in your API keys and AWS credentials
2. Run `npm install` then `npm run dev`
3. Open the app (scan QR code or press `i` for iOS / `a` for Android)
4. Go to **Settings** tab → Create an account (AWS Cognito)
5. Grant **microphone permission** when prompted
6. Go to **Home** tab → Select languages → Tap microphone → Speak!

**Troubleshooting:** If recording doesn't work, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

## Features

- **Realtime Audio Translation**: Record audio and get instant translations with low latency (<500ms where possible)
- **Comprehensive Language Support**: 50+ languages including all major Indian languages (Tamil, Telugu, Kannada, Malayalam, Hindi, Marathi, Bengali, Gujarati, Punjabi, Urdu) and international languages (Spanish, Japanese, German, Chinese, Korean, Arabic, French, and more)
- **Automatic Language Detection**: Whisper automatically detects the source language
- **Conversation Mode**: Automatically switch between Person A and Person B for back-and-forth conversations with language swapping
- **Multi-TTS Provider Support**: Choose between OpenAI TTS, ElevenLabs v3 (preferred for Indian and RTL languages), or Inworld TTS for natural-sounding audio in all supported languages
- **Voice Gender Selection**: Choose male or female voice per TTS provider
- **Streaming Translation**: Real-time token-by-token translation display via Server-Sent Events (SSE)
- **Translation History**: Save and review all past translations stored in AWS DynamoDB
- **User Authentication**: Secure sign-in/sign-up powered by AWS Cognito
- **Offline Fallback**: App functions in offline mode when AWS services are unavailable
- **Modern UI**: Clean, intuitive interface with realtime feedback and native language display

## Tech Stack

- **Frontend**: React Native 0.81 with Expo 54 (managed workflow)
- **Authentication**: AWS Cognito (User Pool + Identity Pool)
- **Database**: AWS DynamoDB (conversation history and user settings)
- **On-device STT**: whisper.rn (whisper.cpp bindings, ggml-tiny model, 39 MB)
- **Translation Cache**: AsyncStorage (30-day TTL, keyed by text + language pair)
- **AI Services**:
  - OpenAI Whisper API (cloud fallback STT when on-device model not ready)
  - OpenAI GPT-4o-mini (Translation via SSE streaming, with GPT-4o fallback)
  - OpenAI TTS-1 (Text-to-Speech, cloud provider)
  - ElevenLabs eleven_v3 / eleven_flash_v2_5 (Optional, preferred for Indian & RTL languages)
  - expo-speech (Device built-in TTS — zero latency, zero network, optional)
  - Inworld TTS (Optional, alternative cloud provider)
- **Audio**: expo-av for recording (WAV 16 kHz mono) and playback
- **Navigation**: Expo Router 6 with tab navigation
- **Streaming**: react-native-sse for SSE-based streaming translation

## Prerequisites

- Node.js 18+ and npm
- Expo CLI (`npm install -g expo-cli`) and EAS CLI (`npm install -g eas-cli`)
- OpenAI API Key (required)
- AWS Account with Cognito User Pool and DynamoDB configured (required for auth and history)
- ElevenLabs API Key (optional, recommended for Indian and RTL language TTS)
- Inworld API Key (optional, for alternative TTS)
- iOS Simulator (for iOS development) or Android Emulator (for Android development)

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
cd project
npm install
```

### 2. Environment Variables

All API keys and cloud credentials are configured in the `.env` file. Copy `.env.example` to `.env` and fill in your values:

```env
# OpenAI
EXPO_PUBLIC_OPENAI_API_KEY=sk-proj-your-key-here

# ElevenLabs (optional)
EXPO_PUBLIC_ELEVENLABS_API_KEY=sk_your-key-here

# AWS Configuration (required for auth and history)
EXPO_PUBLIC_AWS_REGION=us-east-1
EXPO_PUBLIC_AWS_USER_POOL_ID=us-east-1_xxxxxxxxx
EXPO_PUBLIC_AWS_USER_POOL_CLIENT_ID=your-client-id
EXPO_PUBLIC_AWS_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Restart the Expo development server after editing `.env` to load the new values.

### 3. Understanding API Keys

**Why API keys are in `.env`:**

- **Security**: Keys are injected at build time and never stored in user-facing database
- **Privacy**: Your translations use YOUR OpenAI account — fully private
- **Cost Control**: You pay OpenAI directly based on your usage (typically $0.001–0.005 per translation)
- **No Subscription**: No monthly fees to a third-party service
- **Transparency**: Track all usage directly in your OpenAI and ElevenLabs dashboards

**Important Note:**
- All API keys are set in the `.env` file **before running the app**
- The Settings screen manages language preferences, TTS provider, and voice gender only
- AWS credentials are used for user authentication (Cognito) and data persistence (DynamoDB)

### 4. Get Your API Keys

#### OpenAI API Key (Required)

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Add it to `.env` as `EXPO_PUBLIC_OPENAI_API_KEY`

#### AWS Setup (Required for Auth & History)

1. Create a Cognito User Pool in [AWS Console](https://console.aws.amazon.com/cognito)
2. Create a Cognito Identity Pool linked to the User Pool
3. Create two DynamoDB tables: `conversation_history` and `user_settings` (partition key: `user_id`)
4. Add the region, User Pool ID, Client ID, and Identity Pool ID to `.env`

#### ElevenLabs API Key (Optional — Recommended for Indian Languages)

1. Sign up at [ElevenLabs](https://elevenlabs.io/)
2. Go to your profile settings → copy your API key
3. Add it to `.env` as `EXPO_PUBLIC_ELEVENLABS_API_KEY`
4. ElevenLabs is the recommended TTS provider for Indian languages and RTL scripts

#### Inworld API Key (Optional)

1. Sign up at [Inworld AI](https://www.inworld.ai/)
2. Navigate to the API section and create a new key
3. Enter this in the app's Settings screen

### 5. Running the App

#### Start Development Server

```bash
npm run dev
```

This will start the Expo development server. You can then:

- Press `i` to open iOS Simulator
- Press `a` to open Android Emulator
- Scan the QR code with Expo Go app on your physical device

#### Build for Production (EAS Build)

For Android APK (preview build):
```bash
eas build --platform android --profile preview
```

For iOS:
```bash
eas build --platform ios --profile preview
```

For a local Android build:
```bash
eas build --platform android --profile preview --local
```

## Using the App

### First Time Setup

1. **Sign Up**: Open the app and navigate to the Settings tab
2. **Create Account**: Enter your email and password, then tap "Sign Up" (powered by AWS Cognito)
3. **Verify Email**: Enter the confirmation code sent to your email
4. **Select TTS Provider**: Choose your preferred TTS provider (OpenAI, ElevenLabs, or Inworld) and voice gender
5. **Set Default Languages**: Choose default source and target languages
6. **Save Settings**: Tap "Save Settings"

### Translating Audio

1. **Go to Home Tab**: Navigate to the Home screen
2. **Select Languages**: Choose your source and target languages from the dropdowns (or use "Auto Detect" for source)
3. **Enable Conversation Mode** (Optional): Toggle on for automatic Person A ↔ Person B language switching
4. **Record**: Tap the microphone button and start speaking
5. **Stop Recording**: Tap the stop button when finished (or say "stop", "end", or "over")
6. **View Results**: See the transcribed text and streaming translation in realtime
7. **Listen**: The translated audio plays automatically via your selected TTS provider

### Conversation Mode

1. **Enable the Conversation Mode toggle** on the Home screen
2. Select your two languages (e.g., Tamil → Malayalam)
3. **Person A**: Press mic, speak in Tamil → hears Malayalam translation
4. **Person B**: Press mic, speak in Malayalam → hears Tamil translation
5. The app automatically swaps speakers after each turn

### Viewing History

1. **Go to History Tab**: Navigate to the History screen
2. **View Past Translations**: Scroll through your translation history (loaded from DynamoDB)
3. **Replay Audio**: Tap "Play Translation" to hear the translated audio again
4. **Delete Items**: Tap the trash icon to delete individual translations
5. **Clear All**: Tap "Clear All" to delete your entire history

## Supported Languages

**50+ languages** including all major Indian languages and international languages:

### Indian Languages (10)
- Hindi (हिन्दी)
- Tamil (தமிழ்)
- Telugu (తెలుగు)
- Kannada (ಕನ್ನಡ)
- Malayalam (മലയാളം)
- Marathi (मराठी)
- Bengali (বাংলা)
- Gujarati (ગુજરાતી)
- Punjabi (ਪੰਜਾਬੀ)
- Urdu (اردو)

### Major International Languages
- English
- Spanish (Español)
- French (Français)
- German (Deutsch)
- Japanese (日本語)
- Chinese/Mandarin (中文)
- Korean (한국어)
- Arabic (العربية)
- Russian (Русский)
- Portuguese (Português)
- Italian (Italiano)

### Additional Languages (30+)
Turkish, Polish, Dutch, Swedish, Danish, Norwegian, Finnish, Greek, Czech, Hungarian, Thai, Vietnamese, Indonesian, Malay, Filipino, Hebrew, Persian, Ukrainian, Romanian, Bulgarian, Slovak, Croatian, Serbian, Catalan, Swahili, and more

**Note on Indian Languages:**
- All Indian languages are fully supported by OpenAI Whisper for transcription
- GPT-4o is used as fallback for low-resource Indian languages (Malayalam, Kannada, Gujarati, Punjabi, Bengali, Marathi, Urdu) for higher quality
- ElevenLabs (eleven_v3 model) is the recommended TTS provider for Indian and RTL languages
- The app displays language names in their native scripts (தமிழ், తెలుగు, ಕನ್ನಡ, മലയാളം, etc.)

## Architecture

### Services

- **whisperService**: On-device STT via whisper.rn (ggml-tiny, 39 MB download on first run). Falls back to OpenAI Whisper cloud API if model not ready yet.
- **translationCache**: AsyncStorage-backed translation cache (30-day TTL). Returns instantly for repeated phrases, skipping GPT call entirely.
- **audioService**: Handles audio recording (**WAV, 16 kHz mono** — optimised for whisper.cpp) and playback using expo-av, with silence detection.
- **openaiService**: OpenAI Whisper cloud STT (used as fallback by whisperService when on-device model is loading).
- **ttsService**: Multi-provider TTS — OpenAI TTS-1, ElevenLabs (eleven_v3 / eleven_flash_v2_5), expo-speech (device, zero latency), Inworld. Returns `string | null` (`null` for device provider).
- **translationService**: Orchestrates single-shot flow: record → on-device transcribe → cache lookup → GPT translate → TTS → play.
- **RealtimeTranslationService**: Manages conversation mode with automatic Person A/B alternation, language swapping, cache-backed translation.
- **dynamoService**: DynamoDB CRUD operations for conversation history and user settings.

### Cloud Infrastructure

**Entirely serverless — no traditional backend server:**

| Service | Purpose |
|---------|---------|
| AWS Cognito User Pool | User registration, sign-in, email verification |
| AWS Cognito Identity Pool | Credential bridging for DynamoDB access |
| AWS DynamoDB | Stores conversation history and user settings |
| OpenAI API | Whisper STT, GPT translation, TTS-1 |
| ElevenLabs API | High-quality TTS (Indian & RTL languages) |
| Inworld API | Alternative TTS provider |

### Database Schema (DynamoDB)

#### conversation_history
- `user_id` (partition key) — isolates records per user
- `timestamp` — sort key for chronological ordering
- `source_text`, `translated_text` — translation content
- `source_language`, `target_language` — language codes
- `created_at` — ISO timestamp

#### user_settings
- `user_id` (partition key) — isolates settings per user
- `default_source_language`, `default_target_language`
- `tts_provider` — selected TTS provider (openai / elevenlabs / inworld)
- `voice_gender` — male or female
- `custom_voice_id` — optional ElevenLabs voice clone ID
- `conversation_mode_default` — boolean

> Audio files are generated on-demand by TTS providers and streamed locally. No audio files are stored in the cloud.

### Project Structure

```
project/
├── app/                          # Expo Router screens
│   ├── _layout.tsx               # Root layout with AuthProvider
│   └── (tabs)/
│       ├── _layout.tsx           # Tab navigation
│       ├── index.tsx             # Home screen (main translator UI)
│       ├── history.tsx           # Translation history
│       └── settings.tsx          # Settings, auth, TTS provider, voice gender
├── components/
│   └── LanguagePicker.tsx        # Language selection dropdown
├── contexts/
│   └── AuthContext.tsx           # AWS Cognito auth state + DynamoDB init
├── services/
│   ├── whisperService.ts         # On-device STT (whisper.rn tiny) + cloud fallback
│   ├── translationCache.ts       # AsyncStorage translation cache (30-day TTL)
│   ├── audioService.ts           # Recording (WAV 16kHz mono) & playback (expo-av)
│   ├── openaiService.ts          # OpenAI Whisper STT (cloud fallback)
│   ├── ttsService.ts             # Multi-provider TTS (OpenAI / ElevenLabs / expo-speech / Inworld)
│   ├── translationService.ts     # Single-shot translation orchestration
│   ├── RealtimeTranslationService.ts  # Conversation mode (Person A/B)
│   └── dynamoService.ts          # AWS DynamoDB CRUD
├── lib/
│   ├── aws.ts                    # AWS SDK setup (Cognito, DynamoDB clients)
│   └── constants.ts              # Language definitions, script validation patterns
├── types/
│   └── index.ts                  # TypeScript interfaces (User, Settings, History)
├── hooks/
│   └── useFrameworkReady.ts      # Framework initialization
├── .github/
│   └── workflows/
│       └── build-apk.yml         # GitHub Actions APK build pipeline
├── app.json                      # Expo config, permissions
└── .env                          # API keys & AWS config (not committed)
```

### Adding New Languages

To add support for a new language:

1. Open `lib/constants.ts`
2. Add the language to the `SUPPORTED_LANGUAGES` array:

```typescript
{ code: 'xx', name: 'Language Name', nativeName: 'Native Name' }
```

3. Update voice mappings in `services/ttsService.ts` if needed for ElevenLabs or Inworld

## CI/CD Pipeline

The app uses **GitHub Actions** to build Android APKs automatically:

- **Trigger**: Push to `Realtime_AI_Translator_13_02_v2` branch or manual dispatch
- **Process**: Checkout → Install deps → Create `.env` from GitHub Secrets → EAS local build
- **Output**: APK artifact retained for 7 days
- **Required Secrets**: `EXPO_PUBLIC_OPENAI_API_KEY`, `EXPO_PUBLIC_ELEVENLABS_API_KEY`, `EXPO_PUBLIC_AWS_REGION`, `EXPO_PUBLIC_AWS_USER_POOL_ID`, `EXPO_PUBLIC_AWS_USER_POOL_CLIENT_ID`, `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID`, `EXPO_TOKEN`

## Performance Optimization

- **Streaming Translation**: GPT responses stream token-by-token via SSE for immediate feedback
- **ElevenLabs Flash Model**: `eleven_flash_v2_5` provides ~75ms TTS latency for Western/CJK languages
- **Smart Model Selection**: `eleven_v3` for Indian/RTL, `eleven_flash_v2_5` for all others
- **GPT-4o Fallback**: Low-resource Indian languages automatically use the stronger GPT-4o model
- **Silence Detection**: Recording stops automatically on silence, reducing unnecessary audio length
- **Local Audio Cache**: Generated TTS audio is cached in device cache directory

## Security

- API keys are stored in `.env` and injected at build time — never stored in a user-facing database
- AWS Cognito handles all authentication; tokens are cached locally via AsyncStorage
- DynamoDB access is scoped per `user_id` partition key — users can only access their own data
- AWS Identity Pool credentials are scoped to DynamoDB read/write only
- HTTPS/TLS for all API communications (OpenAI, ElevenLabs, AWS)

## Troubleshooting

### Microphone Permissions

If you're having issues with audio recording:

**iOS**:
- Go to Settings > Privacy > Microphone
- Enable microphone access for Expo Go or your app

**Android**:
- Go to Settings > Apps > Your App > Permissions
- Enable microphone permission

### API Key Issues

If translations aren't working:
- Verify your OpenAI API key in `.env` is correct and starts with `sk-`
- Check your OpenAI account has credits/active billing
- Restart the Expo server after editing `.env` (`npm run dev`)

### AWS / Auth Issues

If sign-in or history isn't working:
- Verify all `EXPO_PUBLIC_AWS_*` values in `.env` are correct
- Check that the Cognito User Pool and DynamoDB tables exist in the specified region
- The app has an offline fallback — if AWS is unavailable, local mode is used automatically

### Audio Playback Issues

If audio isn't playing:
- Check your device volume (hardware buttons)
- On iOS, check the physical silent switch
- Try switching TTS provider in Settings

## Contributing

This is a production application. Feel free to customize and extend it for your needs.

## License

MIT License — feel free to use this project for personal or commercial purposes.

## Credits

- Built with [Expo](https://expo.dev/) and [React Native](https://reactnative.dev/)
- Powered by [OpenAI](https://openai.com/) (Whisper, GPT-4o-mini, TTS)
- Authentication & Database by [AWS](https://aws.amazon.com/) (Cognito + DynamoDB)
- Optional TTS by [ElevenLabs](https://elevenlabs.io/) and [Inworld AI](https://www.inworld.ai/)

## Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review the [Expo Documentation](https://docs.expo.dev/)
3. Check [OpenAI API Documentation](https://platform.openai.com/docs)
4. Review [AWS Cognito Documentation](https://docs.aws.amazon.com/cognito/)
5. Review [AWS DynamoDB Documentation](https://docs.aws.amazon.com/dynamodb/)
