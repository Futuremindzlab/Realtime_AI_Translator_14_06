# Setup Checklist

Use this checklist to ensure everything is configured correctly before running the app.

## Step 1: Environment Variables (.env)

- [ ] **Copy `.env.example` to `.env`** (or create `.env` in the project root)

- [ ] **Add your OpenAI API Key** (Required)
  ```
  EXPO_PUBLIC_OPENAI_API_KEY=sk-proj-your-key-here
  ```
  Get a key at: https://platform.openai.com/api-keys

- [ ] **Add AWS Configuration** (Required for auth and history)
  ```
  EXPO_PUBLIC_AWS_REGION=us-east-1
  EXPO_PUBLIC_AWS_USER_POOL_ID=us-east-1_xxxxxxxxx
  EXPO_PUBLIC_AWS_USER_POOL_CLIENT_ID=your-client-id
  EXPO_PUBLIC_AWS_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  ```
  These come from your AWS Cognito setup (see README for AWS setup guide)

- [ ] **(Optional) Add ElevenLabs API Key** — Recommended for Indian languages
  ```
  EXPO_PUBLIC_ELEVENLABS_API_KEY=sk_your-key-here
  ```
  Get a key at: https://elevenlabs.io/

## Step 2: Install Dependencies and Run

- [ ] **Install dependencies**
  ```bash
  npm install
  ```

- [ ] **Start development server**
  ```bash
  npm run dev
  ```
  > **Important:** Always restart the server after editing `.env` to load the new values.

- [ ] **Open the app on your device**
  - iOS: Press `i` in terminal (opens simulator)
  - Android: Press `a` in terminal (opens emulator)
  - Physical device: Scan QR code with Expo Go app

## Step 3: In-App Configuration

### Create Account (AWS Cognito)

- [ ] Open the app
- [ ] Navigate to **Settings** tab (bottom right)
- [ ] You should see "Sign In" or "Create Account" section
- [ ] Enter your email address
- [ ] Enter a strong password (8+ characters recommended)
- [ ] Tap **Sign Up**
- [ ] Enter the **verification code** sent to your email

**Expected result:** "Account created successfully" message appears

### Configure TTS and Language Preferences

- [ ] In Settings, select your preferred **TTS Provider**:
  - **OpenAI TTS** — reliable, works for all languages
  - **ElevenLabs** — best quality for Indian and RTL languages (requires ElevenLabs API key in `.env`)
  - **Inworld** — alternative provider
- [ ] Select **Voice Gender** (male or female)
- [ ] Set your **Default Source Language** (or leave as "Auto Detect")
- [ ] Set your **Default Target Language**
- [ ] Tap **Save Settings**

**Expected result:** "Settings saved successfully"

## Step 4: Grant Microphone Permission

- [ ] Navigate to **Home** tab (bottom left)
- [ ] You should see "AI Translator" at the top
- [ ] Tap the large **microphone button**
- [ ] A permission dialog should appear

**On iOS:**
- [ ] Dialog says "Allow [App] to access your microphone?"
- [ ] Tap **Allow**

**On Android:**
- [ ] Dialog asks for microphone permission
- [ ] Tap **Allow** or **While using the app**

**On Web:**
- [ ] Browser asks for microphone access
- [ ] Click **Allow**

**Expected result:** Permission granted, no error appears

## Step 5: Make Your First Translation

- [ ] On Home screen, select your **Source Language** (or use "Auto Detect")
- [ ] Select your **Target Language** (must be different from source)
- [ ] (Optional) Toggle **Conversation Mode** ON for back-and-forth translation
- [ ] Tap the **microphone button**
- [ ] Speak clearly for 3–5 seconds in your source language
  - Example: "Hello, how are you today?"
- [ ] Release the button or tap **stop**
- [ ] Wait 2–5 seconds

**Expected results:**
1. "Transcribing audio..." appears
2. Your original text appears in the "Original Text" box
3. Streaming translation appears word-by-word in the "Translated Text" box
4. "Playing translation..." appears
5. You hear the translated audio playing

**Success!** Your app is working correctly.

---

## Common Issues

### "API Key Required" or no translations happening

**Problem:** OpenAI API key is missing or not loaded

**Solution:**
- [ ] Open `.env` in the project root
- [ ] Add `EXPO_PUBLIC_OPENAI_API_KEY=sk-your-key-here`
- [ ] Stop and restart `npm run dev`
- [ ] Try translating again

### "Sign In Required" alert appears

**Problem:** You're not signed into your AWS Cognito account

**Solution:**
- [ ] Go to Settings tab
- [ ] Sign up for an account or sign in
- [ ] Return to Home tab and try again

### Can't sign up / verification email not received

**Problem:** AWS Cognito configuration issue or email in spam

**Solution:**
- [ ] Check all `EXPO_PUBLIC_AWS_*` values in `.env` are correct
- [ ] Check your spam/junk folder for the verification code
- [ ] Wait 1–2 minutes and try again

### "Microphone Permission Required" alert appears

**Problem:** Microphone permissions not granted

**Solution:**
- [ ] Go to your device Settings
- [ ] Find the app permissions
- [ ] Enable Microphone permission
- [ ] Return to app and try again

### Recording starts but translation fails

**Problem:** Invalid API key or no OpenAI credits

**Solution:**
- [ ] Check `EXPO_PUBLIC_OPENAI_API_KEY` in `.env` is correct
- [ ] Go to https://platform.openai.com/account/billing
- [ ] Ensure you have credits or billing enabled
- [ ] Restart Expo server after any `.env` change

### Audio doesn't play

**Problem:** TTS provider issue or volume

**Solution:**
- [ ] Check your device volume (hardware buttons)
- [ ] On iOS, check the physical silent switch on the side of the phone
- [ ] Try a different TTS provider in Settings
- [ ] For ElevenLabs, make sure `EXPO_PUBLIC_ELEVENLABS_API_KEY` is set in `.env`

---

## Verification Checklist

After setup, verify everything works:

- [ ] Can sign in/out successfully (AWS Cognito)
- [ ] Can save settings without errors (TTS provider, voice gender, languages)
- [ ] Can select different languages (50+ available)
- [ ] Microphone button responds to taps
- [ ] Can record audio (button changes state, "Recording..." appears)
- [ ] Transcription shows original text
- [ ] Streaming translation shows translated text word-by-word
- [ ] Audio plays automatically after translation
- [ ] Translations appear in History tab (stored in DynamoDB)
- [ ] Can replay audio from history
- [ ] Can delete history items

## You're All Set!

If all items are checked, your app is fully configured and ready to use!

**Next Steps:**
- Try different language combinations
- Test Conversation Mode (Person A ↔ Person B alternation)
- Try ElevenLabs for higher quality Indian language TTS
- Test voice command: say "stop", "end", or "over" to end recording

**Need Help?**
- See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for detailed solutions
- See [README.md](./README.md) for full documentation
