# API Key Debugging Guide

## Issue: "Failed to transcribe audio" Error

If you're seeing the error "Failed to transcribe audio. Please check your OpenAI API key and try again," follow these steps:

---

## Step 1: Check Your Developer Console

The app now includes detailed logging. Open your browser's developer console (or React Native Debugger) and look for these logs:

### Expected Successful Logs:
```
Initializing OpenAI service with API key
API key starts with: sk-proj (or sk-...)
API key length: 164 (or similar)
OpenAI service initialized: true
```

### What to Look For:
- **"No OpenAI API key found in settings"** → Your API key wasn't saved properly
- **API key length is very short (< 50 characters)** → Incomplete or wrong key
- **API key doesn't start with "sk-"** → Invalid key format

---

## Step 2: Verify Your API Key Format

### Valid OpenAI API Keys:
- **Start with:** `sk-proj-` or `sk-`
- **Length:** 150-200 characters typically
- **Example:** `sk-proj-abcd1234efgh5678...` (much longer)

### Check Your Key:
1. Go to https://platform.openai.com/api-keys
2. Copy your key carefully
3. Make sure you copied the ENTIRE key (not just part of it)
4. Verify there are no spaces at the beginning or end

---

## Step 3: Save API Key Correctly

### In the App:

1. **Go to Settings Tab**
2. **Make sure you're signed in** (see your email displayed)
3. **Paste your OpenAI API key** in the "OpenAI API Key (Required)" field
4. **Check the key starts with "sk-"** before saving
5. **Tap "Save Settings"** at the bottom
6. **Look for:** "Settings saved successfully! Your API key is now active."
7. **Go back to Home Tab**
8. **Look for:** Green "✅ Ready to Translate" box

### Visual Indicators:

✅ **Good - You'll see:**
```
✅ Ready to Translate
OpenAI API key is active. Select languages and start speaking!
```

❌ **Bad - You'll see:**
```
🔑 API Key Required
Please add your OpenAI API key in Settings to start translating.
```

---

## Step 4: Test the API Key Directly

### Check if Your Key is Valid:

Open your browser console or terminal and run:

```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY_HERE"
```

Replace `YOUR_API_KEY_HERE` with your actual key.

**Expected Response:**
- List of available models (means key is valid)

**Error Response:**
- "Incorrect API key" → Key is wrong or expired
- "You exceeded your quota" → No credits/billing issue
- Network error → Internet connection problem

---

## Step 5: Check OpenAI Account Status

1. **Go to:** https://platform.openai.com/account/billing
2. **Check:**
   - ✅ Do you have credits or active billing?
   - ✅ Is your payment method valid?
   - ✅ Have you set up billing?

**Note:** Free trial credits may have expired. You need an active payment method.

---

## Step 6: Common Issues & Solutions

### Issue: "Invalid API key format"

**Cause:** Key doesn't start with "sk-"

**Solution:**
- Get a new key from https://platform.openai.com/api-keys
- Make sure you're using an API key, not an organization key

### Issue: "OpenAI API quota exceeded"

**Cause:** No credits or billing not set up

**Solution:**
1. Go to https://platform.openai.com/account/billing
2. Add payment method
3. Add credits or set up automatic billing

### Issue: "Network error"

**Cause:** Internet connection or firewall

**Solution:**
- Check internet connection
- Try cellular data instead of WiFi (or vice versa)
- Disable VPN temporarily
- Check if your network blocks OpenAI API

### Issue: API key saves but still doesn't work

**Cause:** Key may be invalid or app needs restart

**Solution:**
1. Sign out from Settings
2. Close the app completely
3. Reopen the app
4. Sign in again
5. Check if API key is still there
6. If not, re-enter it

---

## Step 7: Try These Tests

### Test 1: Check Settings Persistence

1. Go to Settings → Enter API key → Save
2. Close the app completely
3. Reopen the app
4. Go to Settings
5. **Check:** Is your API key still there (showing as dots)?

**If NO:** Settings aren't saving → Check if you're signed in

### Test 2: Check Console Logs

When you try to record:

1. Open browser developer console (F12 or Cmd+Option+I)
2. Go to Console tab
3. Try recording in the app
4. Look for:
   ```
   Preparing audio file for transcription...
   Audio file prepared, sending to Whisper API...
   ```

**If you see:** "Error details: Invalid authentication"
→ Your API key is definitely wrong

**If you see:** "Error details: Network error"
→ Internet/firewall issue

### Test 3: Verify Initialization

After saving your API key:

1. Go to Home screen
2. Open console (F12)
3. Look for:
   ```
   Initializing OpenAI service with API key
   API key starts with: sk-proj
   API key length: 164
   OpenAI service initialized: true
   ```

**If "OpenAI service initialized: false":**
→ Something went wrong with initialization

---

## Step 8: Still Not Working?

### Collect This Information:

1. **Console logs** when you try to record
2. **Full error message** from the alert
3. **API key format** (first 10 characters only)
4. **OpenAI account status** (active billing?)

### Quick Checklist:

- [ ] I'm signed into the app
- [ ] My API key starts with "sk-"
- [ ] My API key is 150+ characters
- [ ] I see "Settings saved successfully" after saving
- [ ] I see "✅ Ready to Translate" on Home screen
- [ ] I have active billing on OpenAI
- [ ] My internet connection works
- [ ] I've tried restarting the app

---

## Step 9: Create a Fresh API Key

Sometimes keys get corrupted. Try creating a new one:

1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Name it "AI Translator App"
4. Copy the ENTIRE key immediately
5. Paste in a text file to verify it's complete
6. Copy from text file to app
7. Save settings
8. Try again

---

## Emergency Workaround

If nothing works, try this:

1. Sign out from the app
2. Delete the app data/cache (in device settings)
3. Reopen the app
4. Create a NEW OpenAI API key
5. Sign up with a DIFFERENT email in the app
6. Enter the NEW API key
7. Try translating

---

## Contact Support

If you've tried everything above and it still doesn't work:

1. Share the **console logs** (sanitize your API key!)
2. Share the **exact error message**
3. Confirm your **OpenAI account has billing**
4. Note your **platform** (iOS/Android/Web)

**Common Cause:** 90% of the time, it's one of these:
- Incomplete API key copied (only part of it)
- No billing set up on OpenAI
- Free trial credits expired
- Wrong key format (using wrong type of key)
