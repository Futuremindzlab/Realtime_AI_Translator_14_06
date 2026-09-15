# Tests

Two separate suites, run separately (they belong to different `package.json`s):

```bash
npm test                              # app: lib/, services/ — pure logic only
cd backend && npm test                # backend: signature verification, pricing
```

## What's covered

- `lib/plans.ts` — the displayed Plus/Live price stays in sync with what
  `backend/src/lib/razorpay.mjs` actually charges (these two files are
  deliberately duplicated, not imported from one source — see that file's own
  comment for why — so nothing else catches them drifting apart).
- `lib/errors.ts` — `isNetworkError`'s classification of fetch/Cognito
  failures, since `AuthContext`'s retry/offline-messaging behavior branches on
  it.
- `backend/src/lib/razorpay.mjs` — `verifySubscriptionPaymentSignature` and
  `verifyWebhookSignature`, the two functions standing between an
  unauthenticated request and "mark this user as paid." A bug here is a
  billing-security bug, not a cosmetic one.

## What's *not* covered yet — and why this is a starting point, not full coverage

- **No component rendering.** `AuthGate`, `OnboardingFlow`, `PaywallView`, the
  tab screens — none of these are exercised. That needs
  `@testing-library/react-native` (not installed) plus mocking
  `amazon-cognito-identity-js`/`react-native-razorpay`'s native modules, which
  is a real chunk of setup on its own. Worth doing next, but deliberately left
  out of this first pass rather than rushed in alongside everything else this
  session touched.
- **No Razorpay Checkout / UPI Autopay verification.** Nothing here can
  confirm UPI actually appears at checkout or that a real subscription
  charges correctly — that requires Razorpay test-mode credentials and a
  real (or emulated) device run, which this environment doesn't have. Treat
  it as a manual QA step: subscribe with a test card AND a UPI test
  handle, confirm both complete and the webhook flips `plan` in DynamoDB.
- **No native-module tests** (`react-native-razorpay`, `expo-speech`, audio
  recording) — these only run on a real device/native build, not under Jest.

## Adding a test

App-side: drop a `*.test.ts` under `__tests__/` (subfolders are fine — Jest's
`testMatch` here is recursive). Backend-side: same pattern under
`backend/__tests__/`, using `node:test` + `node:assert/strict` (no extra
dependency — matches the rest of the backend's zero-framework style).
