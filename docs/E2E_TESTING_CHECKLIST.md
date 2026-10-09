# OneLingo — Pre-Release Manual Test Checklist

Run this end-to-end, on a **real Android device** (not just the emulator —
mic/AppState/background behavior differs), before every Play Store push.
It's organized so the parts most likely to break first come first.

Each item fixed in a past bug report is marked **[REGRESSION]** with the PR
that fixed it — these are the highest-value checks, since they're exactly
the class of bug that's already slipped through once.

Record results in a copy of this file (or paste into a tracker) with ✅ / ❌
/ ⚠️ per row, plus the APK build number tested and the device/Android
version. Keep it — a failed row that was ✅ last release is the fastest way
to catch a real regression.

---

## 0. Before you start

- [ ] Note the APK's build commit / `EXPO_PUBLIC_BUILD_SHA` (visible in
      Settings → Diagnostics) so a failure can be pinned to a specific build.
- [ ] Test on at least one **OEM-skinned** Android device if possible
      (Samsung/Xiaomi/OnePlus) — several past bugs (AppState blips, audio
      focus) only reproduced on OEM launchers, not stock/Pixel.
- [ ] Fresh install (not an upgrade) for at least one full pass, and an
      upgrade-over-previous-build pass for at least one pass.

## 1. Install & first launch

- [ ] APK installs without a signature/parsing error.
- [ ] **[REGRESSION — #69]** After installing a *new* build over an old one
      (not a fresh install), the home-screen icon actually updates. If it
      doesn't, check `eas.json`'s `preview` profile still has
      `autoIncrement: true`.
- [ ] **[REGRESSION — #70]** The home-screen icon shows the real Four-Stop
      gradient (gold → orange → hot pink → purple), not a flat pink/orange
      square. A flat color means `app.config.js`'s
      `android.adaptiveIcon.backgroundImage` regressed back to
      color-only.
- [ ] App icon looks correct in the app switcher / recents view too.
- [ ] First launch shows onboarding (language/mic permission prompts), not a
      crash or blank screen.
- [ ] Microphone permission prompt appears and granting it lets recording
      start.

## 2. Auth

Test **every** path below, not just login — each is a separate code path
that can break independently.

- [ ] Sign up with email + password → confirmation code email arrives →
      entering it completes signup.
- [ ] Sign up with an already-registered email shows a clear error, not a
      silent failure.
- [ ] Sign in with email + password (existing account).
- [ ] Sign in with wrong password shows a clear error.
- [ ] Phone/OTP sign-in: code SMS arrives, entering it signs in.
- [ ] Forgot password: request code → email arrives → enter code + new
      password → can sign in with the new password.
- [ ] **[REGRESSION — #66]** Close the app fully (swipe away from recents),
      reopen it **without** signing in again — session should restore
      automatically. If it asks you to log in again, that's the Cognito
      session-restore race regressing (`lib/aws.ts`'s `cognitoStorageReady`).
- [ ] Sign out, then confirm the app actually returns to the login screen
      (not a stuck loading state).
- [ ] Delete Account (Settings → Account) actually removes access — sign
      back in with the same credentials should now require signing up again.

## 3. Single-mode translation (conversation toggle OFF)

- [ ] Press Start, speak a short clear sentence (>3 words), press Stop →
      transcription, translation, and TTS playback all complete.
- [ ] **[REGRESSION — #71]** Say something **very short** — "Hi", "No",
      "OK", or a single word in a non-English language — press Stop. It
      should translate normally, **not** show "No speech detected". (The
      old bug: anything under 3 characters was silently discarded
      regardless of content.)
- [ ] Sit in silence for the full recording window, press Stop → shows "No
      speech detected", not a false transcript.
- [ ] Speak near a TV/music/other ambient noise → should either transcribe
      real words or correctly reject as no-speech — should **not** show a
      transcript consisting of a word/phrase repeated many times in a row
      (the Whisper "stuck decoder" hallucination `lib/whisperHallucinations.ts`
      is meant to catch).
- [ ] Background the app mid-recording (home button), wait 2+ seconds,
      return → recording should be cleanly stopped (not stuck on
      "Listening…" forever).
- [ ] Recording auto-stops at the max duration (90s) if you just leave the
      mic open.

## 4. Conversation mode (toggle ON, Person A ↔ Person B)

- [ ] Start a conversation, Person A speaks, Person B speaks — turns
      alternate correctly and both get translated/spoken.
- [ ] Say nothing for a full turn (silence timeout) — control hands to the
      other person automatically, conversation doesn't hang.
- [ ] Let 2-3 consecutive silence handovers happen with nobody speaking —
      conversation should show "No one is speaking. Please restart." and
      stop, not loop forever.
- [ ] **[REGRESSION — ongoing investigation, not yet fully resolved]** Watch
      Settings → Diagnostics logs (or `adb logcat`) during a few turns for
      `AppState changed` lines flipping background→active within ~100ms of
      each other. If you see this *and* a turn gets rejected as a
      `repeating-loop` hallucination right after, check the same log line
      for `interruptedByAppStateBlip: true` — this confirms (rather than
      just correlates) that an OS-level focus blip glitched that recording.
      Report whether this still happens and on which device/launcher.
- [ ] Tap Stop mid-conversation — conversation ends immediately, no
      lingering audio, no turn still processing in the background.
- [ ] Background the app fully for 5+ seconds during an active conversation
      → conversation is cleanly torn down (not silently still "listening"
      when you return).
- [ ] Language auto-detect on Person A's first turn resolves to a real
      language, not stuck on "auto" or misdetected as the target language.

## 5. Settings / Preferences

- [ ] Change default source/target language, save, restart app → new
      defaults are actually applied on next launch.
- [ ] Toggle "Auto Conversation Mode" default, save, restart → respected.
- [ ] Switch TTS provider to each of: OpenAI, ElevenLabs, Azure, Device —
      each one actually produces audio in that voice (they sound
      different — a silent fallback to the wrong provider is a bug).
- [ ] Device TTS with an Indian/Arabic target language auto-upgrades to
      ElevenLabs (per the UI copy) — confirm it's not silently falling
      back to a mispronouncing device voice instead.
- [ ] Pick a specific voice (male/female) per provider — confirm the voice
      actually changes, not just the UI selection state.
- [ ] Share Diagnostics (email and full-share variants) actually produces a
      log file/export, not an empty or crashed share sheet.

## 6. Voice Cloning (Live plan only)

- [ ] On a **Basic/Plus** account, Voice Cloning section shows the upgrade
      prompt, not the record UI.
- [ ] On a **Live** account: record 30-60s of clear speech, it completes
      and shows a cloned voice is active.
- [ ] If cloning fails, the error shown is specific (e.g. an ElevenLabs
      permission/quota message), not a generic crash. See the
      `voices_write` permission issue — confirm the ElevenLabs API key
      backing `ELEVENLABS_API_KEY` has Voices: Write enabled before
      blaming the app.
- [ ] After cloning, run a translation with ElevenLabs TTS selected — the
      output should sound like the cloned voice, not a stock one.
- [ ] Remove cloned voice — reverts cleanly to default voices, no crash.
- [ ] Recording under 10s is blocked client-side with a clear "(min 10s)"
      message, not sent to the backend to fail there.

## 7. Plans & billing

- [ ] Subscribe to Plus from Settings → Razorpay checkout opens, completing
      a (sandbox/test) payment upgrades the account, UI reflects the new
      plan immediately.
- [ ] Subscribe to Live the same way.
- [ ] Cancel subscription → plan reverts to Basic (check timing matches
      whatever your cancellation policy is — immediate vs. end-of-period).
- [ ] Drive a Basic account's daily AI-call count to the limit (20/day) —
      confirm it's actually blocked with a clear message, not silently
      still working or hard-crashing.
- [ ] Confirm a Plus/Live account is **not** blocked at the Basic limit —
      i.e. the plan-based limit (200/400) is actually what's enforced, not
      a stale default.

## 8. History / Phrases / Stats tabs

- [ ] History tab lists past translations, newest first; tapping one
      replays its audio.
- [ ] Deleting a history entry actually removes it (doesn't reappear on
      pull-to-refresh).
- [ ] Phrases: add a custom phrase, it's saved and playable; delete it,
      it's gone.
- [ ] Stats dashboard loads without error and numbers look sane (not stuck
      at zero for an account with real usage, not a crash on first load for
      a brand-new account with zero usage).

## 9. Network & offline resilience

- [ ] Start a translation, then turn on Airplane Mode mid-flight — shows a
      clear connection-issue message, doesn't hang forever or crash.
- [ ] Recover from Airplane Mode — next translation works normally (no
      stuck "offline" state requiring an app restart).
- [ ] Kill the backend's reachability briefly (or just test on a flaky
      connection) — conversation mode retries with backoff rather than
      dying on the first blip (bounded retry, not infinite).

## 10. Release-specific (Play Store)

- [ ] `versionCode`/`versionName` actually incremented from the last
      published build (Settings → Diagnostics or Play Console).
- [ ] Privacy Policy link in Settings/onboarding opens and loads (not a
      404 or draft link).
- [ ] App icon in the Play Console listing preview matches what's installed
      on-device (same gradient, same glyph).
- [ ] No `console.log` of transcribed/translated text leaking in a
      production build (spot-check via `adb logcat` with a release build —
      `babel-plugin-transform-remove-console` should have stripped these).

---

## Reporting a failure back to Claude

When something in this checklist fails, paste:
1. The exact row that failed.
2. The Settings → Diagnostics log excerpt around the failure (timestamps
   matter — this is what let the AppState-blip and no-speech-length bugs
   get root-caused instead of just patched over).
3. Device model + Android version + APK build SHA.

That's enough to root-cause from, the same way the last several bugs in
this app were actually fixed rather than guessed at.
