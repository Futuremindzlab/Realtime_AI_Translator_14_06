# Apple In-App Purchase Integration — iOS Subscriptions

The iOS counterpart to `RAZORPAY_INTEGRATION.md` (used on Android). Apple requires
apps distributed through the public App Store to sell digital subscriptions through
Apple's own In-App Purchase (StoreKit) system, not a third-party processor like
Razorpay — see [App Store Review Guideline 3.1.1](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase).
Razorpay stays exactly as-is for Android; this is additive, not a replacement.

Sources consulted while building this (same reasoning as RAZORPAY_INTEGRATION.md —
verified against the library's actual source on GitHub, since a payment-verification
API signature is security-critical code, not something to guess from memory):
- [app-store-server-library-node](https://github.com/apple/app-store-server-library-node) (README + source, incl. `jws_verification.ts` and `models/*.ts` for exact method/field names)
- [react-native-iap](https://github.com/hyochan/react-native-iap) (README + `src/index.ts` for exact exported function signatures)

## Why no shared secret / API key the way Razorpay has one

Razorpay's webhook/verify authenticity relies on an HMAC shared secret. Apple's relies
on cryptographically signed JWS payloads, verified against Apple's own public root
certificate — nothing secret is held server-side for the core verify/webhook flow.
(An App Store Connect API key *is* needed for calls the App Store Server API itself,
e.g. actively looking up a subscription's live status outside of a webhook —
not implemented here, since it isn't needed for the purchase/renewal/refund flow
below; add it later if you want an admin "re-sync from Apple" tool.)

## How it works

1. **Subscribe (client, iOS only):** the Settings screen's Upgrade button calls
   `react-native-iap`'s `requestPurchase()` directly against StoreKit — unlike
   Razorpay, there's no server round-trip beforehand to create anything.
2. **Binding the purchase to a user — `appAccountToken`:** Apple's purchase request
   accepts an `appAccountToken` (a UUID), which Apple embeds into the signed
   transaction and returns on every future decode of it. The client sets this to the
   caller's Cognito `sub` (already a UUID) — this is Apple's equivalent of Razorpay's
   `subscription.notes.user_id`, and it's what `verifyApplePurchase` trusts instead of
   any client-supplied claim.
3. **Verify (fast path):** right after purchase, the client reads the signed
   transaction (`getTransactionJwsIOS()`) and calls
   `POST /v1/billing/apple/verify` with it. The backend verifies the JWS's signature
   + x5c certificate chain against Apple's own root certificate
   (`lib/appleIap.mjs`'s `verifyAndDecodeTransaction`), confirms the decoded
   `appAccountToken` matches the authenticated caller, maps the decoded `productId`
   to a plan, and updates DynamoDB immediately — same "fast UI update" role as
   Razorpay's verify call.
4. **Webhook (source of truth):** `POST /v1/billing/apple/notifications` —
   unauthenticated (Apple calls it directly), body is a signed JWS ("App Store Server
   Notifications V2") verified the same way. Handles `SUBSCRIBED`/`DID_RENEW` (apply
   the plan — this is what carries every renewal), `DID_FAIL_TO_RENEW` with a
   `GRACE_PERIOD` subtype (record status, keep access), and
   `EXPIRED`/`GRACE_PERIOD_EXPIRED`/`REFUND`/`REVOKE` (downgrade to `basic`).
5. **Cancel:** there is deliberately no `/v1/billing/apple/cancel` route — Apple
   provides no server API for cancelling a user's subscription. The client-side
   equivalent for an iOS user is `react-native-iap`'s `showManageSubscriptionsIOS()`,
   which opens Apple's own subscription-management sheet.
6. **Sandbox vs Production:** a single Apple ID can be testing against a TestFlight
   build (Sandbox-signed payloads) while real users hit the same endpoint with
   Production-signed ones. `lib/appleIap.mjs` keeps two `SignedDataVerifier`
   instances and tries Production first, falling back to Sandbox.

## App Store Connect setup (only you can do this part)

1. **Apple Developer Program** enrollment, if not already done ($99/yr).
2. **Bundle identifier** — reserve one in Certificates, Identifiers & Profiles (e.g.
   matching Android's `com.mohan.aitranslator`, or your own choice) and set it as
   `ios.bundleIdentifier` in `app.config.js` — **do this before creating the App
   Store Connect app record**; it can't be changed after.
3. **App Store Connect app record**, tied to that bundle ID. Its numeric **App Apple
   ID** (visible in App Information) is `AppleAppAppleId` below.
4. **Subscription group + two auto-renewable subscription products** (Plus / Live) —
   Features ▸ Subscriptions. Each product's Product ID is `AppleProductIdPlus` /
   `AppleProductIdLive` below (a reverse-DNS string you choose, e.g.
   `com.mohan.aitranslator.plus.monthly`).
5. A **Sandbox Tester account** (Users and Access ▸ Sandbox) for testing purchases
   without spending real money.

## Deploy steps

```bash
cd backend && npm install   # pulls in @apple/app-store-server-library

sam build && sam deploy --parameter-overrides \
  ...(existing params)... \
  AppleBundleId=com.mohan.aitranslator \
  AppleAppAppleId=1234567890 \
  AppleProductIdPlus=com.mohan.aitranslator.plus.monthly \
  AppleProductIdLive=com.mohan.aitranslator.live.monthly
```

`AppleAppAppleId` can be left blank until the App Store Connect app record exists —
Sandbox/TestFlight verification still works without it (see `lib/appleIap.mjs`'s
`getProductionVerifier` doc comment); only Production verification needs it.

In App Store Connect: App Information ▸ App Store Server Notifications ▸ set the
Production and Sandbox URLs to
`https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/v1/billing/apple/notifications`.

(Add `AppleBundleId`/`AppleAppAppleId`/`AppleProductIdPlus`/`AppleProductIdLive` as
GitHub Actions secrets + `--parameter-overrides` entries in
`.github/workflows/deploy-backend.yml` if you want this deployed automatically — not
wired in by this change, same as Razorpay's equivalent secrets.)

## Testing

Sign into a Sandbox Tester Apple ID on a real device or the Simulator, then purchase
through the app as normal — no real money moves. App Store Connect can also send a
test notification (`requestTestNotification` on `AppStoreServerAPIClient` — not
wired into this integration since the core flow doesn't need
`AppStoreServerAPIClient` at all, but available if you add an admin tool later) to
exercise the webhook without waiting for a real renewal.

## Files touched

| File | Change |
|---|---|
| `backend/src/lib/appleIap.mjs` | New — root-CA fetch/cache, dual Sandbox/Production `SignedDataVerifier`, product-ID↔plan mapping |
| `backend/src/handlers/billing.mjs` | `verifyApplePurchase` / `handleAppleNotification` handlers, `applyAppleSubscriptionState` |
| `backend/src/handlers/settings.mjs` | `putSettings`/`resetSettings` now preserve `apple_original_transaction_id`/`_status` across a preferences save/reset, same treatment as the Razorpay fields |
| `backend/src/handlers/account.mjs` | Doc comment only — no Apple-side cancel call exists to make (see "Cancel" above) |
| `backend/src/index.mjs` | Routes the 2 new `/v1/billing/apple/*` endpoints |
| `backend/template.yaml` | 4 new Parameters, 4 new env vars on `TranslatorFunction`, unauthenticated notifications route + its OPTIONS |
| `backend/package.json` | `@apple/app-store-server-library` dependency |
| `backend/__tests__/appleIap.test.mjs` | New — product-ID↔plan mapping tests (see the file's own note on what isn't covered and why) |
| `types/index.ts` | `UserSettings.apple_original_transaction_id` / `_status` |

**Not yet done — client side and iOS build pipeline are separate, larger pieces**:
adding `react-native-iap`, wiring the Settings screen's Upgrade flow for iOS, and a
new EAS iOS build profile/workflow. Tracked as the next step.
