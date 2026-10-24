# Play Store release — OneLingo (Android)

Everything needed to get `com.mohan.aitranslator` from this repo onto Google Play:
what's already handled in code, the text to paste into Play Console, and the
steps only the account owner can do.

---

## 0. Blockers to clear first

| # | Item | Why it matters |
|---|------|----------------|
| 1 | **Subscriptions are sold through Razorpay inside the app.** | Google Play's Payments policy requires digital subscriptions bought inside an Android app to use Google Play Billing. In India you may alternatively enroll in *user choice billing*, which keeps Razorpay but requires offering Play Billing beside it. Shipping Razorpay alone is very likely to be rejected or removed later. A decision is pending in the project thread. |
| 2 | **Reviewer login.** | Every feature needs an account, so Play reviewers need working credentials (section 4, "App access"). Create a dedicated **email + password** account (OTP-by-phone logins can't be handed to a reviewer) and put it on the Live plan in the settings table so the reviewer never hits the 7-day trial paywall. |
| 3 | **Crash reporting is off in release builds.** | `EXPO_PUBLIC_SENTRY_DSN` isn't set anywhere in CI/EAS. Either set it in EAS → Environment variables → production (the Data safety answers below assume crash logs *are* collected), or untick "Crash logs" / "Diagnostics" in Data safety. The two must match. |

---

## 1. What's already handled in the repo

- **Release build = Android App Bundle.** `eas.json` → `build.production.android.buildType: "app-bundle"` (Play requires AAB for new apps). `versionCode` auto-increments remotely on every production build (`appVersionSource: "remote"` + `autoIncrement`).
- **Target SDK 36** (Expo SDK 54 / React Native 0.81), which satisfies Play's current target-API requirement for new apps.
- **Signing.** EAS generates and stores the upload keystore on the first production build (answer *Yes* to "Generate a new Android Keystore?"). Google then holds the real app-signing key via **Play App Signing** (on by default for new apps). Back up the upload key once: `eas credentials -p android` → *Download credentials*. Keep it somewhere safe outside the repo.
- **Permissions trimmed to what's used.** The shipped manifest declares `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `CAMERA`, `INTERNET`, `VIBRATE`. `app.config.js` → `android.blockedPermissions` strips storage, "display over other apps" and the media-playback foreground-service permission that libraries add but the app never uses. That last one would otherwise force a foreground-service declaration with a demo video in Play Console.
- **Account deletion** works in-app (Settings → Delete Account), and now also removes the user's cloned voice from the voice provider. The policy page documents a no-app deletion route (email) at `https://theonelingo.com/legal/policies.html#delete-account`.
- **Privacy policy** at `https://theonelingo.com/legal/policies.html#privacy` covers audio, transcripts, Scan photos, the optional voice sample, diagnostics, retention (90 days), deletion and the grievance officer.
- **`eas submit`** is configured to upload to the **internal testing** track as a **draft**, using a service-account key at `./play-service-account.json` (git-ignored, see section 3).

---

## 2. Build the release

1. **EAS production env vars.** In expo.dev → *onelingo* → Environment variables → **production**, set: `EXPO_PUBLIC_AWS_REGION`, `EXPO_PUBLIC_AWS_USER_POOL_ID`, `EXPO_PUBLIC_AWS_USER_POOL_CLIENT_ID`, `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID`, `EXPO_PUBLIC_API_BASE_URL` (and `EXPO_PUBLIC_SENTRY_DSN` if you want crash reports). Without these the build succeeds but the app can't reach the backend.
2. **Bump the user-facing version** if needed: `version` in `app.config.js` (currently `1.0.0`; this is the `versionName` users see).
3. **Build.** GitHub → Actions → *Create Production Builds* → Run workflow → platform `android`. Or locally: `eas build -p android --profile production`.
4. Download the `.aab` from the EAS build page.

## 3. First upload (manual, once)

Google requires the very first bundle of a new app to be uploaded by hand.

1. Play Console → *Create app* → name **OneLingo**, default language English (India) or English (US), **App**, **Free** (an app with subscriptions is still "Free"), accept declarations.
2. *Test and release → Testing → Internal testing* → *Create new release* → upload the `.aab` → add release notes → save → roll out to your internal testers.
3. Install from the internal-testing opt-in link on a real phone and smoke-test sign-in, a translation, Conversation Mode, Scan and Delete Account.

**Later uploads via `eas submit`** (optional):
1. Google Cloud Console → create a service account → create a JSON key.
2. Play Console → *Users and permissions* → invite the service-account email → grant *Release apps to testing tracks* (and *Release to production* if you want).
3. Save the key as `play-service-account.json` in the repo root (it's git-ignored), then `eas submit -p android --profile production --latest`.

---

## 4. Play Console → App content (Policy → App content)

### Privacy policy
`https://theonelingo.com/legal/policies.html#privacy`

### Ads
**No**, the app does not contain ads.

### App access
*All or some functionality is restricted* → add instructions:

> Sign in on the Settings tab with the email and password below. The account is on the Live plan, so every feature is unlocked.
> Email: `<reviewer email>` · Password: `<reviewer password>`
> Main features: Home tab (tap the mic, speak, hear the translation), Conversation Mode, Scan tab (point the camera at printed text).

### Content rating (IARC questionnaire)
- Category: **Utility, Productivity, Communication, or Other**.
- Violence, sexuality, language, controlled substances, gambling: **No** to all.
- Do users interact or exchange content with each other? **No**. Translations are private to the user, with no chat between users.
- Does the app share the user's location with others? **No**.
- Does the app allow digital purchases? **Yes**.
- Is the app a web browser or search engine? **No**.
- Expected result: **Everyone / PEGI 3 / IARC 3+**.

### Target audience and content
- Target age groups: **18 and over** (simplest, and consistent with the policy's "not directed at children"). You can add 13–17 later. Don't select anything under 13, or the app falls under the Families policy.
- Could the app unintentionally appeal to children? **No**.

### News app / COVID-19 / Government / Financial features / Health
**No** / not applicable to all of these.

### Data safety
Answer the top-level questions:
- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes** (HTTPS only, cleartext disabled)
- Do you provide a way for users to request that their data is deleted? **Yes**
- Delete account URL (asked under *Data deletion*): `https://theonelingo.com/legal/policies.html#delete-account`

**Shared** = *No* for every row. Passing data to service providers that process it on your behalf (cloud hosting, AI models, payment processor) doesn't count as "sharing" under Play's definitions.

| Data type (Play category) | Collected | Optional? | Purposes |
|---|---|---|---|
| Personal info → **Name** | Yes | Required | Account management |
| Personal info → **Email address** | Yes | Required (email sign-in) | Account management, App functionality |
| Personal info → **Phone number** | Yes | Optional (only for phone/OTP sign-in) | Account management |
| Personal info → **User IDs** | Yes | Required | Account management, App functionality |
| Personal info → **Other info** (country) | Yes | Required | App functionality |
| Financial info → **Purchase history** | Yes | Optional (paid plans only) | App functionality, Account management |
| Financial info → **User payment info** | Yes *while Razorpay checkout runs inside the app*. Remove this row if Android payments move to Play Billing, since Google collects it then. | Optional | App functionality |
| Audio → **Voice or sound recordings** | Yes | Required | App functionality |
| Photos and videos → **Photos** | Yes (Scan & Translate) | Optional | App functionality |
| App activity → **Other user-generated content** (transcripts and translations) | Yes | Required | App functionality |
| App activity → **App interactions** (usage counts for trial and plan limits) | Yes | Required | App functionality, Analytics |
| App info and performance → **Crash logs** | Yes (only if Sentry is enabled, see blocker 3) | Required | Analytics |
| App info and performance → **Diagnostics** | Yes | Optional ("Share Diagnostics") | Analytics |

Leave **"processed ephemerally"** unticked everywhere. Even Scan photos pass through the AI provider, which may retain request data for abuse monitoring.

If the onboarding name or country can be skipped in the app, mark them *Optional*.

### Permissions (no Console form needed)
Microphone and camera don't need a Play declaration, but reviewers read the in-app prompts. They're already set:
- Mic: *"This app needs access to the microphone to record audio for translation."* Android shows its system dialog when the mic button is first tapped.
- Camera: *"The OneLingo uses your camera to read and translate signs, menus, and other printed text."*
- No location, contacts, SMS, call-log, storage or media-library permissions are declared, so there are no sensitive-permission forms.

### AI-generated content (watch item)
Play's AI-Generated Content policy asks apps that *generate* content with AI to let users report offensive output without leaving the app. A translator is borderline, but voice cloning is squarely the kind of feature reviewers look at. A small "Report a problem with this translation" action on a result (email or backend log) is cheap insurance; worth adding before a production rollout.

---

## 5. Main store listing (Grow → Store presence → Main store listing)

**App name** (max 30): `OneLingo: AI Voice Translator`

**Short description** (max 80):
`Speak, hear and scan translations in 45+ languages. Talk to anyone, anywhere.`

**Full description** (max 4000):

```
OneLingo turns your phone into a personal interpreter. Speak naturally and hear the translation out loud a moment later, in a real, natural-sounding voice.

TALK, DON'T TYPE
Tap the mic, say what you need, and OneLingo transcribes, translates and speaks it for you. No typing, no copy-paste.

CONVERSATION MODE
Two people, two languages, one phone. The mic switches direction automatically after each reply, so a conversation flows the way it should.

SCAN & TRANSLATE
Point your camera at a sign, a menu, a bus board or a notice, and read it in your own language instantly. Or pick a photo you already took.

SOUNDS LIKE YOU (Live plan)
Record a short voice sample once, and your translations are spoken in your own voice instead of a stranger's.

45+ LANGUAGES, DONE RIGHT
Including native-script accuracy for 10 Indian languages (Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi and more), Arabic and other right-to-left scripts.

HANDY EXTRAS
• Translation history you can replay
• Saved phrases for the things you say often
• Pick your default language once and go

PRIVATE BY DESIGN
• Your conversations auto-delete after 90 days
• Delete your account and all your data any time, right inside the app
• No ads, and we never sell your data

PLANS
• Basic: free 7-day trial
• Plus: streaming translation that starts speaking before the sentence is finished
• Live: everything in Plus, spoken in your own voice

Translations are generated by AI and can occasionally be wrong. Please don't rely on them for medical, legal or safety-critical situations.

Questions or feedback? Write to Admin@futuremindzlab.com
```

> Keep the PLANS bullets in sync with whichever billing route is chosen.

**App category:** Travel & Local (alternative: Tools). **Tags:** Translation, Travel, Language learning.
**Contact details:** email `Admin@futuremindzlab.com` · website `https://theonelingo.com`.

### Graphics checklist
| Asset | Spec | Source |
|---|---|---|
| App icon | 512×512 PNG, 32-bit, ≤1 MB | Export from `assets/images/icon.png` at 512 px |
| Feature graphic | 1024×500 JPG/PNG, no alpha | New: brand gradient + "One app. Every language." from the website hero |
| Phone screenshots | 2–8, 16:9 or 9:16, min 1080 px on the short side recommended | Home translating, Conversation Mode, Scan result, language picker, history |
| 7" / 10" tablet screenshots | Optional | Skip for the first release |

Screenshots with a one-line caption above the phone frame ("Talk in 45+ languages", "Point. Scan. Understand.") convert noticeably better than raw captures.

---

## 6. Going to production

1. **Developer account type decides the path.**
   - *Organization account* (Futureminds Lab LLP, verified with a D-U-N-S number): can promote straight from internal/closed testing to production once App content is complete.
   - *Personal account created after Nov 2023*: Google requires a **closed test with at least 12 testers opted in for 14 consecutive days** before you can apply for production access. Start that closed test as early as possible, since it's the longest pole.
2. *Publishing overview* → make sure every App content item shows a green tick.
3. *Production* → *Create new release* → promote the tested bundle → choose countries (start with **India**, add more later) → *Review release* → *Start rollout*. A staged rollout (20% → 50% → 100%) is a cheap safety net.
4. First review typically takes a few days; new developer accounts can take up to a week or more.

---

## 7. Promotion (brief)

- **Store listing experiments** (Grow → Store listing experiments): A/B test the icon, first screenshot and short description once you have a few hundred visits a week. This is free and the single biggest lever on install rate.
- **Custom store listings**: a Tamil, Hindi, etc. listing (translated text + screenshots in that language) for users whose device is set to it. For a translator app this is both on-brand and effective.
- **Ratings**: add the Play **In-App Review API** prompt after a user's 3rd or 4th successful translation, never on first launch. Reply to every review in the first months.
- **Website → Play badge**: put the official "Get it on Google Play" badge on theonelingo.com and link the store URL from Instagram/YouTube bios.
- **Short demo videos** (Reels/Shorts) of real situations, like reading a bus sign or ordering food in another state. Reuse the best one as the store listing's **promo video** (YouTube link).
- **Google Ads App campaigns** once the listing converts well: start small (₹500–1000/day), target India, optimise for installs, then for in-app actions.
- **Pre-registration** (optional): open pre-registration in Play Console a couple of weeks before launch to collect a list of people who get auto-notified.
