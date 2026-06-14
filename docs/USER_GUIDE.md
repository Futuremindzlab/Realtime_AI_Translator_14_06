# Realtime AI Translator — User Guide

## What the app does

Realtime AI Translator lets you speak in one language and instantly hear the translation in another. It supports 40+ languages, works for one-way translation and back-and-forth conversations, and can clone your voice so translations sound like you.

---

## Getting Started

### Install the app
- **Android**: Install the APK shared with you. When prompted, allow installation from unknown sources.
- **Web**: Open the URL shared with you in Chrome or Safari.

### Grant microphone permission
The first time you tap the mic button, your device will ask for microphone access. Tap **Allow**. Without this, the app cannot hear you.

---

## Creating an Account

1. Open the **Settings** tab (bottom right).
2. Tap **"Don't have an account? Sign Up"**.
3. Enter your email address and a strong password.
   - Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character (e.g. `MyPass@1`).
4. Tap **Sign Up**.
5. Check your email — you will receive a 6-digit verification code.
6. Enter the code in the **Verification Code** field that appears and tap **Verify & Continue**.
7. You are now registered. Go back to sign in with your email and password.

> If you see a red error message, read it — it usually tells you exactly what to fix (e.g. "Password did not conform with policy").

---

## Signing In

1. Open the **Settings** tab.
2. Enter your email and password.
3. Tap **Sign In**.
4. Your name appears at the top of Settings when you are signed in.

> Signing in saves your translation history and preferences to the cloud. The app works without signing in, but history will not be saved.

---

## Your First Translation

1. Go to the **Home** tab.
2. Select your **Source Language** (what you will speak) and **Target Language** (what it translates to).
   - Set Source to **Auto** if you want the app to detect your language automatically.
3. Tap the blue microphone button.
4. Speak clearly into your device's microphone.
5. Tap the red stop button (or wait for silence detection).
6. The app will:
   - Transcribe what you said
   - Translate it
   - Read the translation aloud
7. Your original speech and the translation appear on screen.

---

## Conversation Mode

Conversation mode is for two people speaking different languages face-to-face.

1. Toggle **Conversation Mode** on the Home screen.
2. Tap the microphone.
3. **Person A** speaks — the app translates and reads it aloud.
4. The app automatically listens for **Person B** to respond.
5. Tap the stop button to end the conversation.

The app detects silence between turns and swaps the translation direction automatically.

---

## Changing Languages

- Tap the language selector to open a list of 40+ supported languages.
- Both source and target languages can be changed at any time when not recording.
- Selectors are greyed out while recording is in progress.

---

## Voice Settings

In **Settings → Preferences → Voice**, you can choose how the translation sounds.

### OpenAI TTS voices
| Voice | Style |
|---|---|
| Nova | Female · Warm & natural |
| Shimmer | Female · Soft & clear |
| Alloy | Neutral · Versatile |
| Echo | Male · Mellow |
| Fable | Male · Expressive (British) |
| Onyx | Male · Deep & authoritative |

### ElevenLabs voices (higher quality, requires API key)
| Voice | Style |
|---|---|
| Aria | Female · Versatile |
| Rachel | Female · American |
| George | Male · British |
| Adam | Male · American deep |

### Device voice (fastest, no internet required)
Uses your phone's or browser's built-in voice engine. No voice selection — the device picks the best voice for the language automatically.

---

## Voice Cloning

Voice cloning makes translations sound like your own voice.

1. Go to **Settings → Voice Cloning**.
2. Tap **Record My Voice**.
3. Read aloud naturally for 30–60 seconds (the longer the better).
4. Tap **Stop & Clone Voice**.
5. Wait 15–30 seconds while your voice is processed.
6. Future translations will use your cloned voice automatically.

To remove your cloned voice, tap **Remove Custom Voice** in the same section.

> Voice cloning requires an ElevenLabs API key to be configured.

---

## Translation History

The **History** tab shows all your past translations. Tap any entry to see the full text.

> History is only saved when you are signed in.

---

## Offline / No-Internet Use

The app degrades gracefully when there is no internet:

| Feature | Offline behaviour |
|---|---|
| Speech recognition | Uses on-device AI (downloaded at first launch, ~39 MB) |
| Translation | Uses cached translations for phrases you have translated before |
| Voice playback | Uses your device's built-in voice (no cloud needed) |
| Saving history | Not available — requires cloud connection |

The on-device speech recognition model downloads automatically in the background when you first open the app. This takes a minute on a good Wi-Fi connection.

---

## Troubleshooting

**No sound when translation plays**
- Check your device volume.
- Make sure the app is not muted.
- On iOS, check the silent/ring switch on the side of your phone.

**"OpenAI API key not found" error**
- The app needs an OpenAI API key to translate and transcribe. Contact the person who shared the app with you.

**Sign-in fails with no error message**
- Check your internet connection.
- Make sure Caps Lock is off.
- Try the "Forgot password?" flow by signing up again with the same email.

**Translation is slow**
- The first translation in a session takes longer because models are loading.
- Switch to **Device** voice in Settings → Preferences for faster playback.
- Make sure you are on a fast Wi-Fi connection.

**Mic button does nothing**
- Ensure microphone permission is granted (Settings → Apps → Realtime AI Translator → Permissions).
