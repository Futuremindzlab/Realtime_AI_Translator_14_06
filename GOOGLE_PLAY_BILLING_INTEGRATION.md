# Google Play Billing Integration — Recurring Subscriptions

Replaces the in-app Razorpay checkout (`RAZORPAY_INTEGRATION.md`) as the purchase flow for the `plus`/`live` tiers. Required because Google Play policy requires apps selling digital subscriptions consumed inside the app to sell them through Google's own billing system — a third-party payment processor opened in-app (what Razorpay checkout was) doesn't qualify. Razorpay's backend code is left in place for any in-flight subscriptions from before this switch; nothing in the client calls it to start a new purchase anymore.

Hand-rolled (no RevenueCat or similar) — explicit product decision to avoid an ongoing revenue-share fee on a pre-revenue app. The tradeoff: everything below is infrastructure you own and maintain, not a managed service's problem.

Sources consulted while building this (cited inline in code comments too, since several details here are easy to get subtly wrong and most guides online are outdated or cover the deprecated APIs):
- `node_modules/expo-iap`'s own shipped `.d.ts` files and JSDoc — verified directly rather than trusted from README/community examples, since several (e.g. whether Android subscriptionOffers is required) conflict across sources. See `services/billingService.ts`'s module doc comment.
- [Google Play Developer API — purchases.subscriptionsv2.get](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get) — the current verification endpoint (supersedes the deprecated `purchases.subscriptions.get`).
- [Google Play Developer API — purchases.subscriptions.acknowledge](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge) — acknowledgement endpoint; note it's still on the older `subscriptions` resource, not `subscriptionsv2`.
- [Real-time developer notifications reference](https://developer.android.com/google/play/billing/rtdn-reference) — RTDN payload shape.
- [Play Billing backend guide](https://developers.google.com/chromeos/app-development/publish/play-billing-backend) — the "RTDN is a signal to re-fetch, not the state itself" pattern this implementation follows throughout.

## Why this needed a one-time-claim table, unlike Razorpay

Razorpay's `createSubscription` (server-side) embeds `user_id` into the subscription *before* checkout opens, so `verify`/the webhook can read identity back from Razorpay's own record — the client's claimed identity is never trusted.

Google Play Billing has no equivalent server-side "create" step: the client starts a purchase directly against Play with nothing but a product id. Without a safeguard, anyone holding *any* valid purchase token (their own from a different account, one observed in a log, a stale token from a refund) could call `/verify` as a different authenticated user and claim the paid plan for free. `backend/src/handlers/googlePlayBilling.mjs`'s `claimPurchaseToken` closes this with an atomic DynamoDB conditional write — first `user_id` to successfully verify a given token owns it permanently; a different `user_id` presenting the same token is rejected with 403.

## Prerequisites (all one-time, done in Play Console / Google Cloud Console)

You'll need the app already created as a draft in Play Console (it does **not** need to be submitted/published yet — product setup and Internal Testing both work on a draft app).

### 1. Create the subscription products

Play Console → your app → **Monetize → Products → Subscriptions** → Create subscription, twice:
- Product ID `onelingo_plus_monthly` (must match `lib/plans.ts`'s `PLAY_PRODUCT_ID.plus` exactly) — ₹100/month base plan.
- Product ID `onelingo_live_monthly` (must match `PLAY_PRODUCT_ID.live`) — ₹200/month base plan.

Each needs at least one **active base plan** with an **offer** before it's purchasable — a product with no offers will fail `fetchProducts` client-side with "no offers available."

### 2. Create the service account

Google Cloud Console (same GCP project you'd use for anything else, or a new one) → **IAM & Admin → Service Accounts → Create service account**. No particular role needed at the GCP project level — access is granted inside Play Console instead (next step). Create a JSON key for it and keep it safe; you need two fields out of it:
- `client_email` → `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL` / GitHub secret `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`
- `private_key` → `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY` / GitHub secret `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY` — paste it with its literal `\n` line breaks as-is (don't convert to real newlines); `backend/src/lib/googlePlay.mjs` un-escapes it before use, same as any multi-line PEM secret in a Lambda env var.

### 3. Link the service account to Play Console

Play Console → **Users and permissions** → Invite new user → paste the service account's email → grant **Financial data, orders, and cancellation survey responses** (needed for `subscriptionsv2.get`) under the app's permissions. Takes a few minutes to propagate.

### 4. Enable the Android Publisher API

In the same GCP project as the service account: **APIs & Services → Enable APIs** → enable **Google Play Android Developer API**.

### 5. Set up Real-time Developer Notifications (RTDN)

This is the multi-step part — it's how renewals, grace periods, holds and cancellations reach the backend without polling (Google explicitly warns against polling for quota reasons).

1. **Create a Pub/Sub topic**: GCP Console → Pub/Sub → Create topic (e.g. `play-subscriptions-rtdn`).
2. **Grant Google Play publish rights** to it: on the topic's permissions, add principal `google-play-developer-notifications@system.gserviceaccount.com` with role **Pub/Sub Publisher**. (This is Google's own system account that publishes RTDN events — not your service account.)
3. **Register the topic in Play Console**: Play Console → your app → **Monetize → Monetize setup** → paste the topic's full name (`projects/<project-id>/topics/play-subscriptions-rtdn`) under Real-time developer notifications.
4. **Deploy the backend first** (step 6 below) so you have the real API Gateway URL, then come back and:
5. **Create a push subscription on the topic**, pointed at `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/v1/billing/google-play/rtdn`, with:
   - **Enable authentication** checked.
   - **Service account**: the same one from step 2.
   - **Audience**: the exact endpoint URL above (this becomes `GOOGLE_PLAY_RTDN_AUDIENCE` — must match byte-for-byte or every delivery is rejected by `googlePlay.mjs`'s `verifyRtdnPushToken`).
   - Grant that service account `roles/iam.serviceAccountTokenCreator` **on itself** (GCP requires this for a service account to mint its own OIDC tokens for push auth) — IAM & Admin → the service account → Permissions → grant it `iam.serviceAccountTokenCreator`, principal = itself.
6. **Test it**: Play Console's RTDN settings page has a "Publish test notification" button — use it, then check the Lambda's CloudWatch logs for `ℹ️ Google Play RTDN had no subscription purchase token — ignoring (test notification)` to confirm the push + auth round-trip actually works before testing a real purchase.

## Deploy steps

```bash
cd backend && npm install

# 1. Deploy with the new parameters (package name, service account, product
#    IDs — RTDN audience can go in on a second deploy once you have the URL
#    from the first one; see prerequisite 5 above).
sam build && sam deploy --parameter-overrides \
  ...(existing params)... \
  GooglePlayPackageName=com.mohan.aitranslator \
  GooglePlayServiceAccountClientEmail=your-sa@your-project.iam.gserviceaccount.com \
  GooglePlayServiceAccountPrivateKey="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n" \
  GooglePlayProductIdPlus=onelingo_plus_monthly \
  GooglePlayProductIdLive=onelingo_live_monthly \
  GooglePlayRtdnAudience=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/v1/billing/google-play/rtdn
```

(Add the same as GitHub Actions secrets — `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_PLAY_PRODUCT_ID_PLUS`, `GOOGLE_PLAY_PRODUCT_ID_LIVE`, `GOOGLE_PLAY_RTDN_AUDIENCE` — `.github/workflows/deploy-backend.yml` already reads all of them.)

**Client:** `expo-iap` is a native module — after `npm install` at the repo root, this app needs a native rebuild before the Upgrade buttons work:

```bash
npx expo prebuild
npx expo run:android      # or an EAS build
```

It will **not** work inside plain Expo Go.

## Testing

Play Billing fundamentally cannot be tested by sideloading a signed APK the way the rest of this app has been tested so far — purchases only work for an app whose package name/signing matches a Play Console listing, bought by an account added as a **license tester** (Play Console → Setup → License testing) on a build installed **through Play Console's own Internal Testing track**, not a direct APK download. Budget real time for this: creating the Internal Testing track, adding testers, and the first successful test purchase is a different, slower loop than this project's existing `workflow_dispatch` → download-artifact test cycle.

License testers can use test payment methods (no real charge) and cancel/resubscribe repeatedly without waiting out real billing cycles — see Play Console's License Testing docs for the test-card options once you're at that step.

## Not done here — flagged as follow-ups

- **Upgrade/downgrade between `plus`↔`live` while already subscribed** isn't wired (the `subscriptionOffers`/`subscriptionProductReplacementParams` fields exist in expo-iap's types for this — see `RequestSubscriptionAndroidProps` — but implementing proration handling is separate work). Today, a `plus` subscriber hitting "Upgrade to Live" will attempt a fresh purchase, which Play Billing will likely reject or handle unexpectedly — test this path explicitly before launch if cross-grades matter at launch.
- **`restorePurchases`/`getActiveSubscriptions` on app reinstall or new-device sign-in** isn't wired — a user who reinstalls currently has no in-app way to re-link an existing Play subscription to their account (Google still bills them; the app just won't reflect it until the next RTDN event touches that specific token, which won't happen for an already-active, unchanged subscription). Worth adding a "Restore Purchases" button before launch.
