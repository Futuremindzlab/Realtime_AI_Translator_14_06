/**
 * Sentry crash/error reporting — optional. No-ops entirely if
 * EXPO_PUBLIC_SENTRY_DSN isn't set, same pattern as this app's other
 * optional providers (ElevenLabs/Azure): a missing key disables the
 * feature, not the whole app.
 *
 * lib/logger.ts's error() already forwards here (see its own header
 * comment — it was built as "a single choke point... so a remote sink
 * (Sentry, CloudWatch RUM, etc.) can be wired in later without touching
 * every call site"), and components/ErrorBoundary.tsx routes uncaught
 * render errors through logger.error() too — so nothing else needs to
 * import this file directly beyond calling initSentry() once at startup.
 *
 * NOTE: this wires up JS-level error capture only (uncaught exceptions,
 * logger.error() calls, React render errors caught by ErrorBoundary).
 * Full native crash reporting additionally needs the
 * `@sentry/react-native/expo` config plugin added to app.config.js's
 * `plugins`, which also wires source-map upload into the native build
 * (Gradle/Xcode) — deliberately left out here since it changes
 * build-apk.yml's build behavior in ways that can't be verified without
 * running a real EAS build. Add it once you're ready to test that
 * end-to-end, ideally on a branch, not directly against the working CI.
 */
import * as Sentry from '@sentry/react-native';

let initialized = false;

export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.log('ℹ️ EXPO_PUBLIC_SENTRY_DSN not set — crash reporting disabled');
    return;
  }
  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
  });
  initialized = true;
  console.log('✅ Sentry initialized');
}

/** Safe no-op when Sentry isn't initialized — callers never need to check `initialized` themselves. */
export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!initialized) return;
  if (error instanceof Error) {
    Sentry.captureException(error, { extra: context });
  } else if (error !== undefined) {
    Sentry.captureMessage(String(error), { extra: context });
  }
}
