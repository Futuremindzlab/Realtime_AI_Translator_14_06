# Razorpay Integration — Recurring Subscriptions

Real payment processing for the `plus` (₹200/month) and `live` (₹360/month) tiers already defined in `backend/src/lib/entitlement.mjs`. Before this, the only way to change a user's `plan` was `PATCH /v1/admin/set-plan` — an OWNER-only testing shortcut with no billing behind it (still present, still works, untouched by this change — see `app/(tabs)/settings.tsx`'s "Developer Mode" card).

Sources consulted while building this (Razorpay's own docs domain is blocked by this environment's egress policy, so these are the third-party/GitHub references actually used):
- [react-native-razorpay (GitHub)](https://github.com/razorpay/react-native-razorpay) — Checkout usage
- [razorpay-node (GitHub)](https://github.com/razorpay/razorpay-node) — Node SDK, `subscriptions.create`/`fetch`/`cancel`, `plans.create`
- [razorpay-node's paymentVerification.md](https://raw.githubusercontent.com/razorpay/razorpay-node/master/documents/paymentVerfication.md) — signature formulas
- [Razorpay Webhooks with Node.js (Sreyas IT)](https://sreyas.com/blog/razorpay-webhooks-with-node-js/) and [How to Verify Razorpay Webhook Signatures (DEV Community)](https://dev.to/eventdock/how-to-verify-razorpay-webhook-signatures-and-why-it-is-not-the-payment-signature-1pei) — webhook signature verification (raw body, not re-serialized JSON)
- [@types/react-native-razorpay](https://www.npmjs.com/package/@types/react-native-razorpay) — actual `CheckoutOptions`/`SuccessResponse` shape (inspected directly; the package itself ships no `.d.ts`)

## Why recurring, not one-time

Chosen over a one-time "unlock" purchase because it's real subscription billing — Razorpay's **Plans + Subscriptions** APIs, not the one-time **Orders** API. That means different request shapes, different Checkout fields (`subscription_id` instead of `order_id`/`amount`), a different signature formula, and — critically — **renewals and cancellations happen with the app completely closed**, so a webhook is not optional here the way it might be for a one-time purchase.

## How it works

1. **Setup (once):** `backend/scripts/setup-razorpay-plans.mjs` creates the two Razorpay Plan objects (`plans.create`) and prints their IDs.
2. **Subscribe:** `services/billingService.ts`'s `subscribeToPlan(plan)` calls the backend to create a Subscription (`POST /v1/billing/razorpay/create-subscription`, which calls `subscriptions.create({ plan_id, notes: { user_id, plan } })`), then opens `RazorpayCheckout.open({ subscription_id, recurring: true, ... })`.
3. **Verify (fast path):** on Checkout success, the app calls `POST /v1/billing/razorpay/verify` with the returned `razorpay_payment_id`/`razorpay_subscription_id`/`razorpay_signature`. The backend verifies `HMAC-SHA256(payment_id + "|" + subscription_id, key_secret) === signature`, re-fetches the subscription to read back the authoritative `plan`/`user_id` from its `notes` (never trusts the client's claim), and updates the user's `plan` in DynamoDB immediately — this is just for a snappy UI update.
4. **Webhook (source of truth):** `POST /v1/billing/razorpay/webhook` — unauthenticated (Razorpay calls it directly), signature-verified via `X-Razorpay-Signature` (HMAC-SHA256 over the **raw** body with the separate webhook secret). Handles `subscription.activated`/`charged`/`resumed` (apply the paid plan — this is what actually carries every monthly renewal), `subscription.pending` (payment retry in progress, no downgrade yet), and `subscription.halted`/`cancelled`/`completed`/`paused` (downgrade to `basic`).
5. **Cancel:** `POST /v1/billing/razorpay/cancel` calls `subscriptions.cancel(id, { cancel_at_cycle_end: true })` — the user keeps access through what they already paid for; the actual downgrade happens when `subscription.cancelled` arrives via webhook at cycle end.

## Deploy steps

```bash
cd backend && npm install

# 1. Create the two Plans once (test-mode keys first, then repeat with live keys
#    when you're ready to go live — separate Plan IDs for test vs live).
RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx npm run setup-razorpay-plans
# → prints RazorpayPlanIdPlus / RazorpayPlanIdLive

# 2. In the Razorpay Dashboard: Settings → Webhooks → add
#    https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/v1/billing/razorpay/webhook
#    Subscribe to: subscription.activated, subscription.charged, subscription.pending,
#    subscription.halted, subscription.cancelled, subscription.completed, subscription.paused,
#    subscription.resumed. Copy the webhook secret it generates.

# 3. Deploy with the 5 new parameters
sam build && sam deploy --parameter-overrides \
  ...(existing params)... \
  RazorpayKeyId=rzp_test_xxx \
  RazorpayKeySecret=xxx \
  RazorpayWebhookSecret=xxx \
  RazorpayPlanIdPlus=plan_xxx \
  RazorpayPlanIdLive=plan_xxx
```

(Add the same 5 as GitHub Actions secrets + `--parameter-overrides` entries in `.github/workflows/deploy-backend.yml` if you want this deployed automatically — not wired in by this change, to keep the blast radius of this commit to the app-level integration itself.)

**Client:** `react-native-razorpay` is a native module — after `npm install` at the repo root, this app needs a native rebuild before the Upgrade buttons work:

```bash
npx expo prebuild
npx expo run:ios      # or run:android, or an EAS build
```

It will **not** work inside plain Expo Go.

## Testing

Use Razorpay's [test-mode keys and test cards](https://razorpay.com/docs/payments/payments/test-card-upi-details/) (`rzp_test_...`) — no real money moves. Razorpay's Dashboard can also manually fire a test webhook event at your endpoint to exercise the renewal/cancellation paths without waiting a full month for a real cycle to turn over.

## Files touched

| File | Change |
|---|---|
| `backend/src/lib/razorpay.mjs` | New — Razorpay client singleton, pricing, signature verification (payment + webhook) |
| `backend/scripts/setup-razorpay-plans.mjs` | New — one-time Plan creation, idempotent by name |
| `backend/src/handlers/billing.mjs` | New — create-subscription / verify / cancel / webhook handlers |
| `backend/src/handlers/settings.mjs` | `putSettings`/`resetSettings` now preserve `razorpay_subscription_id`/`_status` across a preferences save/reset, same treatment as `plan` |
| `backend/src/index.mjs` | Routes the 4 new `/v1/billing/razorpay/*` endpoints |
| `backend/template.yaml` | 5 new Parameters, 5 new env vars on `TranslatorFunction`, unauthenticated webhook route + its OPTIONS |
| `backend/package.json` | `razorpay` dependency, `setup-razorpay-plans` script |
| `types/index.ts` | `UserSettings.razorpay_subscription_id` / `_status` |
| `services/dynamoService.ts` | `createRazorpaySubscription` / `verifyRazorpayPayment` / `cancelRazorpaySubscription` |
| `services/billingService.ts` | New — wraps `RazorpayCheckout.open()` + the two backend calls into `subscribeToPlan()`/`cancelSubscription()` |
| `app/(tabs)/settings.tsx` | "Your Plan" card: real Upgrade buttons (all users) + Cancel Subscription, additive to the existing OWNER-only testing switcher |
| `package.json` | `react-native-razorpay` dependency, `@types/react-native-razorpay` devDependency |
