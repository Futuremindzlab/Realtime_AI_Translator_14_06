# Troubleshooting Guide

## App Not Taking Input / Recording Not Working

### Quick Checklist

1. **Have you signed in?**
   - Go to Settings tab → Create an account or Sign In (powered by AWS Cognito)
   - Without an account, the app won't work

2. **Is your OpenAI API key set in `.env`?**
   - Open the `.env` file in the project root
   - Make sure `EXPO_PUBLIC_OPENAI_API_KEY=sk-your-key-here` is filled in
   - Restart the Expo development server after editing `.env`

3. **Have you granted microphone permissions?**
   - The app needs microphone access to record your voice
   - When you first tap the microphone button, you should see a permission request
   - See platform-specific instructions below

### Microphone Permission Issues

#### On iOS (iPhone/iPad)

If microphone isn't working:

1. Go to iPhone/iPad **Settings**
2. Scroll down and find **Expo Go** (or your app name)
3. Tap on it
4. Tap **Microphone**
5. Ensure it's toggled **ON** (green)
6. Return to the app and try again

Alternative method:
1. Go to iPhone/iPad **Settings**
2. Tap **Privacy & Security**
3. Tap **Microphone**
4. Find **Expo Go** or your app
5. Toggle it **ON**

#### On Android

If microphone isn't working:

1. Go to **Settings**
2. Tap **Apps** or **Applications**
3. Find and tap **Expo** or your app name
4. Tap **Permissions**
5. Tap **Microphone**
6. Select **Allow**
7. Return to the app and try again

Alternative method:
1. Long-press the app icon
2. Tap "App info" or the (i) icon
3. Tap **Permissions**
4. Enable **Microphone**

#### On Web Browser

If using the web version:

1. When you tap the microphone button, your browser will ask for permission
2. Click **Allow** when prompted
3. If you accidentally clicked "Block":
   - Click the lock icon (🔒) in the address bar
   - Find "Microphone" in the permissions list
   - Change it from "Block" to "Allow"
   - Refresh the page and try again

### Still Not Working?

Try these steps:

1. **Restart the app completely**
   - Close the app fully
   - Reopen it
   - Try recording again

2. **Verify your `.env` file**
   - Open `.env` in the project root
   - Confirm `EXPO_PUBLIC_OPENAI_API_KEY` starts with `sk-` and has no extra spaces
   - Restart the Expo server: `npm run dev`

3. **Test your microphone**
   - Try using your device's voice recorder or another app
   - Confirm your microphone actually works
   - Check if your device is muted

4. **Check your OpenAI account**
   - Visit https://platform.openai.com/
   - Ensure you have API credits or active billing
   - Check if your API key is valid and not expired

---

## API Key Questions

### Why is the API key in `.env` and not in the app?

API keys are stored in `.env` because:
- Keys are injected securely at build time
- No user-facing database stores your keys
- You control your OpenAI usage and costs directly
- The app never sends your keys to any third-party service

### Is my API key secure?

**YES!** Your API key is:
- Stored only in your `.env` file (local or GitHub Secrets for CI builds)
- Injected into the app bundle at build time via `EXPO_PUBLIC_*` prefix
- Never stored in AWS DynamoDB or any cloud database
- Not visible to other users

### Where do I get an OpenAI API key?

1. Go to https://platform.openai.com/api-keys
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the key (starts with `sk-`)
5. Paste it into `.env` as `EXPO_PUBLIC_OPENAI_API_KEY`

**Important:** Keep your key private — don't commit `.env` to source control.

### Do I need to pay OpenAI?

Yes, OpenAI charges for API usage:
- Very small cost per translation (typically $0.001–0.005 per translation)
- You need to add billing info at https://platform.openai.com/account/billing
- You can set usage limits to control costs
- First-time users may get free credits

---

## Audio Issues

### Recording starts but translation fails

**Possible causes:**

1. **Invalid API key**
   - Check `EXPO_PUBLIC_OPENAI_API_KEY` in `.env`
   - Make sure it's correct and the server was restarted after editing

2. **No OpenAI credits**
   - Check your OpenAI account billing
   - Add payment method or credits

3. **Network connection**
   - Ensure you have internet connection
   - Try switching between WiFi and cellular

4. **Audio too short or too quiet**
   - Speak clearly for at least 2–3 seconds
   - Ensure you're close enough to the microphone

### Translated audio doesn't play

**Possible causes:**

1. **TTS provider issue**
   - Go to Settings
   - Try switching TTS provider (OpenAI / ElevenLabs / Inworld)
   - For ElevenLabs, make sure `EXPO_PUBLIC_ELEVENLABS_API_KEY` is set in `.env`

2. **Volume issues**
   - Check your device volume (hardware buttons)
   - Make sure media volume is up (not just ringer)
   - On iOS, check the physical silent switch on the side of the phone

3. **Audio output**
   - Check if headphones are connected
   - Try switching to speaker or headphones

---

## Translation Issues

### Translation is in the wrong language

1. Check your source and target language selections
2. Make sure they're not the same language
3. If using "Auto Detect", Whisper will try to identify the language — speak clearly

### Translation quality is poor

1. Speak clearly and at a normal pace
2. Reduce background noise
3. Use a better microphone if possible
4. Try shorter phrases (10–20 seconds at a time)

### Translation takes too long

1. **Normal:** Translation typically takes 2–5 seconds
2. **Slow internet:** Check your connection speed
3. **Long audio:** Try shorter recordings
4. **Server load:** OpenAI servers may be busy, try again

---

## Account Issues (AWS Cognito)

### Can't sign in

1. Check your email and password are correct
2. Check for typing errors
3. Ensure caps lock is off
4. Verify your AWS Cognito credentials in `.env` are correct

### Can't sign up

1. Make sure you're using a valid email address
2. Password must meet Cognito strength requirements (typically 8+ characters)
3. Check your internet connection
4. Email might already be registered — try signing in instead

### Not receiving verification email

1. Check your spam/junk folder
2. Wait a few minutes — Cognito sends codes within 1–2 minutes
3. Try signing up again to trigger a new code
4. Check the email address is correct

### App works without signing in

The app has an **offline fallback mode**: if AWS is unreachable, it operates as `offline-user` with local settings. History will not be saved to DynamoDB in this mode.

---

## History Issues

### History not saving

1. Make sure you're signed into your AWS Cognito account
2. Check you have internet connection (DynamoDB requires network)
3. Verify AWS DynamoDB table `conversation_history` exists in the correct region
4. Try force-closing and reopening the app

### Can't play audio from history

1. History stores text only — audio is regenerated via TTS when you press "Play Translation"
2. Check your TTS provider API key is valid
3. Check your internet connection

### History disappeared

1. Make sure you're signed into the same account
2. Check you didn't accidentally clear history
3. Pull down to refresh

---

## General Issues

### App crashes or freezes

1. Close the app completely
2. Restart your device
3. Make sure you have the latest version
4. Clear app cache (in device settings)

### App is slow

1. Close other apps
2. Check your internet speed
3. Try on WiFi instead of cellular
4. Restart the app

### Features not working on Web

Some features work differently on web:
- Microphone requires browser permissions
- Audio recording may have browser compatibility issues
- Use Chrome, Safari, or Firefox for best results
- Mobile devices (iOS/Android) recommended for full features

---

## Getting More Help

### Error Messages

Take note of any error messages and:
1. Check this troubleshooting guide first
2. Try the suggested solutions
3. Take a screenshot if issue persists

### Platform-Specific Help

- **OpenAI Issues**: https://help.openai.com/
- **ElevenLabs Issues**: https://help.elevenlabs.io/
- **Expo/React Native**: https://docs.expo.dev/
- **AWS Cognito**: https://docs.aws.amazon.com/cognito/
- **AWS DynamoDB**: https://docs.aws.amazon.com/dynamodb/

---

## Still Having Issues?

If none of these solutions work:

1. Note exactly what happens when you try to use the app
2. Check if there are any error messages in the terminal / Expo dev console
3. Try on a different device if possible
4. Check your OpenAI account status and billing
5. Verify all `.env` values are correct and the server was restarted
