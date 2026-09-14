// app.config.js — dynamic Expo config
// Explicitly reads EXPO_PUBLIC_* env vars so they are always inlined by Metro
// during both local dev (from .env) and EAS builds (from GitHub Secrets → .env).

// Note: OpenAI/ElevenLabs/Azure API keys are intentionally NOT read here — they
// live server-side in the backend AI proxy (see backend/src/handlers/aiProxy.mjs)
// and must never be inlined into the client bundle.
const required = [
  'EXPO_PUBLIC_AWS_REGION',
  'EXPO_PUBLIC_AWS_USER_POOL_ID',
  'EXPO_PUBLIC_AWS_USER_POOL_CLIENT_ID',
  'EXPO_PUBLIC_API_BASE_URL',
];

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.warn(
    `\n⚠️  [app.config.js] Missing env vars — app features may not work:\n  ${missing.join('\n  ')}\n`
  );
}

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  expo: {
    name: 'OneLingo',
    // Updated from the legacy 'ai-translator-06-09' so `eas init`/`eas build`
    // propose the right EAS project name instead of the pre-rename one —
    // that mismatch was the actual cause of `eas init` repeatedly offering
    // to (re)create "ai-translator-06-09" no matter what the dashboard
    // showed. Safe to change now (unlike `scheme`/`android.package`, which
    // stay untouched — see the comment on those below): no build has ever
    // successfully published with the old slug, so nothing depends on it.
    slug: 'onelingo',
    // Pinned explicitly so `eas init`/`eas build` always create/target the
    // project under the Futuremindzlab org account, never whichever personal
    // account happens to be logged in locally (see the mixup this fixed:
    // extra.eas.projectId below was previously a project actually owned by
    // a personal account, mohanbscbe2010, despite this being an org project).
    owner: 'futuremindzlab',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    // Deliberately NOT renamed alongside `slug` above: this is the deep-link
    // URL scheme (aitranslator://...) baked into whatever's already
    // installed on any test device, and android.package below is the Play
    // Store package id — renaming either is a real migration with
    // consequences (broken links / a new store listing), not a display-name
    // change. Revisit only as a deliberate follow-up if actually wanted.
    scheme: 'aitranslator',
    userInterfaceStyle: 'automatic',
    // NOTE: tried disabling this (newArchEnabled: false) to rule out expo-av's
    // known instability under Fabric/TurboModules — reverted immediately, it
    // breaks the build outright: react-native-reanimated ~4.1.1 (used by
    // react-native-worklets 0.5.1, a hard dependency here) requires the New
    // Architecture and fails the Gradle build with
    // ":react-native-reanimated:assertNewArchitectureEnabledTask FAILED" the
    // moment this is false. Must stay true as long as Reanimated 4.x is a
    // dependency; if expo-av instability under new-arch turns out to be the
    // real cause, the actual fix is migrating audioService/ttsService off
    // expo-av onto expo-audio (already present as a plugin, not yet wired into
    // the code), not disabling new-arch.
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSMicrophoneUsageDescription:
          'This app needs access to the microphone to record audio for translation.',
        NSSpeechRecognitionUsageDescription:
          'This app needs access to speech recognition to transcribe your audio.',
      },
    },
    android: {
      package: 'com.mohan.aitranslator',
      // READ/WRITE_EXTERNAL_STORAGE deliberately dropped: every FileSystem
      // call in this app (whisperService's model cache, audioProcessor's
      // temp WAV, ttsService's temp audio) writes to documentDirectory/
      // cacheDirectory — the app's own private sandbox, which has never
      // needed these permissions on Android. Declaring broad storage access
      // the app doesn't use invites exactly the kind of unjustified-
      // permission flag Play Console review looks for.
      permissions: [
        'RECORD_AUDIO',
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
      ],
      adaptiveIcon: {
        foregroundImage: './assets/images/icon.png',
        backgroundColor: '#0024E6',
      },
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-web-browser',
      [
        'expo-build-properties',
        {
          android: {
            // All endpoints (API Gateway, Cognito, OpenAI/ElevenLabs/Azure) are HTTPS —
            // cleartext (HTTP) traffic is never needed and should stay disabled.
            usesCleartextTraffic: false,
          },
        },
      ],
      'expo-audio',
      'expo-asset',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      // Created via `eas init` under the correct account/slug
      // (@futuremindzlab/onelingo) — see https://expo.dev/accounts/futuremindzlab/projects/onelingo
      eas: { projectId: 'ec47d5da-a5d8-4ae9-a48b-0614e20164db' },
      // Snapshot current env for runtime inspection (values are inlined by Metro)
      awsRegion: process.env.EXPO_PUBLIC_AWS_REGION || '',
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || '',
    },
  },
};
