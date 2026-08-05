/**
 * Races a promise against a hard deadline so a hung native-bridge call (or any
 * other promise that simply never settles) can't freeze the caller forever.
 *
 * Conversation mode's pipeline (record → transcribe → translate → TTS → play)
 * has several await points that ultimately depend on a native module resolving
 * its bridge call — none of them had any ceiling before this. If any one of
 * them hangs (a known risk class for native-module bridge calls, especially
 * under React Native's New Architecture — see app.config.js), the entire
 * conversation loop would sit stuck indefinitely with no error, no retry, and
 * no way to recover short of force-closing the app. That failure mode is only
 * reachable on-device — web never calls a native bridge at all — which is
 * exactly the "works on web, not on APK" shape this was producing.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
