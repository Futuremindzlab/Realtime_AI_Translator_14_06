# Metrics Dashboards (started 2026-07-20)

Two-level access, enforced by the backend rather than the client: an OWNER-role
Cognito account (checked via `cognito:groups`) sees every OWNER-only dashboard
below; any other signed-in account only ever gets `/my-history`, since
`GET /v1/translations` and `GET /v1/billing/history` both key strictly off the
caller's own Cognito `sub`. `components/NavBar.tsx` just hides links a plain
USER account can't use — the actual enforcement is server-side per route.

## Access gate (added 2026-09-17)

`middleware.ts` puts the whole site behind a single shared HTTP Basic Auth
credential, in front of even the sign-in form — set `DASHBOARD_ACCESS_USER`
and `DASHBOARD_ACCESS_PASSWORD` in the hosting environment (e.g. Vercel
project settings → Environment Variables; **not** prefixed `NEXT_PUBLIC_`, so
it stays server-only) and share those two values only with directors/owners.
This is a reachability gate, not the real access control — the OWNER-role
check on every admin API route and the per-user `sub` scoping on
`/my-history`'s routes are what actually decide who sees what data; this just
keeps the dashboard's existence off the open internet for anyone without the
shared credential. Left unset, the gate is a no-op, so local `npm run dev`
needs no extra setup.

## `/subscriptions` — live (added 2026-09-17)

Wired to `GET /v1/admin/subscriptions` (OWNER role required, same sign-in
gate/session as the other OWNER-only pages). Purpose-built payment-tracking
view, separate from `/payments`'s broader "everything about payments" page:

- **Active subscribers + MRR, by plan** — plus vs. live, counted from
  Razorpay subscriptions with status `active`/`authenticated`.
- **Renewing within 7 days** — any active subscription (regardless of
  cancellation status) whose current billing cycle ends within a week.
  Broader than `/user_analytics`'s Churn table, which only covers
  subscriptions a user has already asked to cancel.
- **Needs attention** — subscriptions Razorpay reports as `pending`/`halted`,
  i.e. a renewal charge is actively failing.
- **Status breakdown** — every subscription this account has ever created,
  grouped by its current Razorpay status.

See `backend/src/lib/razorpayReports.mjs`'s `computeSubscriptionsOverview` for
exactly how each section is derived — built entirely from Razorpay's own
subscription objects (`notes.user_id`/`notes.plan`), no DynamoDB scan needed.

## `/my-history` — live (added 2026-09-17)

The USER-facing counterpart to the OWNER dashboards — any signed-in account
(OWNER or plain USER) can view this page, and always sees only its own data:

- **Translation history** — `GET /v1/translations` (existing route, already
  scoped by the caller's Cognito `sub` — this page is the first web client
  for it, mirroring what the mobile app's History screen already does).
- **Billing history** — `GET /v1/billing/history` (added 2026-09-17),
  the self-serve counterpart to `adminPayments.mjs`'s OWNER-only view:
  same Razorpay payments feed, filtered to `notes.user_id === caller`.

## `/user_analytics` — live

Wired to the real backend (`GET /v1/admin/user-analytics`, added 2026-07-20, OWNER role required). Requires signing in with a Cognito account in the `owner` group — the page shows a sign-in form first.

Real: total members, per-user usage (translation count, conversation-mode count, last active, top language pairs) from `GET /v1/admin/user-analytics`; **Revenue / Engagement (WAU+MAU) / AWS Cost / Churn** from a second endpoint, `GET /v1/admin/dashboard-metrics` (added 2026-07-20):

- **Engagement (WAU/MAU)** — real, same underlying computation as the active-rate stats above.
- **AWS Cost** — real *code path* (AWS Cost Explorer, grouped by service, 1-hour in-memory cache since Cost Explorer bills $0.01/request) but currently returns `available: false` — **Cost Explorer itself isn't enabled on this AWS account yet**. That's a one-time manual step in Billing Preferences (console only, not something IAM/API can flip) — enable it there and this section goes live with no code changes.
- **Revenue** and **Churn** — `available: false` by design. No `Transactions` table, no product-tier field, no subscription/expiry data or `renewal_notification_sent` field exist anywhere in this backend; building real versions means implementing the Razorpay integration in `BILLING.md` first. The churn table's UI (columns, renewal-notification badge) is already built and will light up the moment that data exists.
- Region, gender ratio, retention cohorts — dropped from this page (superseded by the Revenue/Churn framing above); same "no data source" reasoning as before if they come back later.

Needs `.env.local` (gitignored, not committed):

    NEXT_PUBLIC_AWS_REGION=us-east-1
    NEXT_PUBLIC_AWS_USER_POOL_ID=us-east-1_ZcvBPWVo2
    NEXT_PUBLIC_AWS_USER_POOL_CLIENT_ID=79uencj6m0muovsb7cci96nsns
    NEXT_PUBLIC_API_BASE_URL=https://cmcfwryq5c.execute-api.us-east-1.amazonaws.com/prod

These aren't secrets (same values the mobile app ships as `EXPO_PUBLIC_*`) — safe to keep in `.env.local`.

## `/infra_security` — partially live (added 2026-07-27)

Wired to `GET /v1/admin/infra-metrics` (OWNER role required, same sign-in gate/session as `/user_analytics`):

- **AWS resource usage & cost** — real. Usage (Lambda invocations, API Gateway requests, DynamoDB WCU/RCU, CloudWatch Logs bytes) comes from CloudWatch `GetMetricData`; Cognito row uses the same MAU computation as the other dashboard. Cost reuses `dashboardMetrics.mjs`'s Cost Explorer call (and its cache) — same `available:false` caveat if Cost Explorer isn't enabled yet.
- **API request counts** (was "API rate limits") — real, but reframed. Every route in this backend — including the four hottest proxy endpoints — shares one API Gateway catch-all resource (`/v1/{proxy+}` ANY), so AWS/ApiGateway's own metrics can't tell routes apart. Instead, `backend/src/lib/routeMetrics.mjs` emits a CloudWatch EMF log line per request for 4 tracked routes (`index.mjs`'s `TRACKED_ROUTES`), and the dashboard reads those back. There's also no API Gateway throttling/usage plan configured on this stack, so there's no real "limit" to show — this is raw request volume, not utilization against a quota. History only exists from whenever this route first deployed.
- **API keys & subscriptions, SSL certificate expiry, CVE tracking** — still mock, `lib/mockInfraSecurity.ts`. Each needs a fundamentally different data source than a CloudWatch query: per-provider billing APIs (only ElevenLabs' `/v1/user/subscription` is realistically wireable among OpenAI/ElevenLabs/Azure/Razorpay), a custom domain with an ACM/Let's Encrypt cert (none exists — API is on the default `execute-api.amazonaws.com` endpoint), and CI-time dependency scanning (`npm audit` or GitHub Dependabot alerts) respectively.

## Run

    npm install
    npm run dev

## Structure

    app/
      user_analytics/page.tsx   client component: sign-in gate + live fetch
      infra_security/page.tsx   client component: same sign-in gate + partially-live fetch
      payments/page.tsx         client component: same sign-in gate, OWNER-only
      subscriptions/page.tsx    client component: same sign-in gate, OWNER-only
      my-history/page.tsx       client component: sign-in gate, any signed-in account (own data only)
    components/                  shared StatCard, SectionCard, BarList, DonutChart, StatusBadge, NavBar
    lib/
      cognitoAuth.ts             Cognito sign-in (amazon-cognito-identity-js)
      session.ts                 shared sessionStorage read/write for the Session Cognito sign-in returns
      userAnalyticsApi.ts        fetch wrapper for /v1/admin/user-analytics
      dashboardMetricsApi.ts     fetch wrapper for /v1/admin/dashboard-metrics
      infraMetricsApi.ts         fetch wrapper for /v1/admin/infra-metrics
      paymentsApi.ts             fetch wrapper for /v1/admin/payments
      subscriptionsApi.ts        fetch wrapper for /v1/admin/subscriptions
      myHistoryApi.ts            fetch wrappers for /v1/translations and /v1/billing/history (caller's own data)
      mockInfraSecurity.ts       mock data for the still-unwired parts of the infra board (keys, SSL, CVEs)

## Backend

All in the main `TranslatorFunction` Lambda:

- `backend/src/handlers/adminAnalytics.mjs` — per-user usage table (`/v1/admin/user-analytics`, OWNER-only).
- `backend/src/handlers/dashboardMetrics.mjs` — Revenue/Engagement/AWS Cost/Churn (`/v1/admin/dashboard-metrics`, OWNER-only).
- `backend/src/handlers/infraMetrics.mjs` — AWS resource usage/cost + per-route request counts (`/v1/admin/infra-metrics`, OWNER-only, added 2026-07-27).
- `backend/src/handlers/adminPayments.mjs` — active users by plan + live Razorpay orders (`/v1/admin/payments`, OWNER-only).
- `backend/src/handlers/adminSubscriptions.mjs` — active subs by plan/MRR, renewing-within-week, needs-attention (`/v1/admin/subscriptions`, OWNER-only, added 2026-09-17).
- `backend/src/handlers/billing.mjs`'s `getMyBillingHistory` — caller's own Razorpay payments only (`/v1/billing/history`, any authenticated account, added 2026-09-17).
- `backend/src/handlers/translations.mjs`'s `listTranslations` — caller's own translation history (`/v1/translations`, pre-existing, also used by the mobile app).
- `backend/src/lib/usageAnalytics.mjs` — shared `conversation_history` scan + per-user aggregation used by the OWNER-only handlers above.
- `backend/src/lib/routeMetrics.mjs` — emits the CloudWatch EMF per-route request metric (added 2026-07-27); `index.mjs`'s `TRACKED_ROUTES` decides which 4 routes get counted.
- `backend/src/lib/razorpayReports.mjs` — shared Razorpay pagination + the `computeRevenueByTier`/`computeChurn`/`computeSubscriptionsOverview` pure functions.

IAM additions in `backend/template.yaml`: `cognito-idp:ListUsers` (CognitoAdminPolicy), `ce:GetCostAndUsage` (CostExplorerPolicy), and `cloudwatch:GetMetricData` + `logs:DescribeLogGroups` (new `InfraMetricsPolicy`, added 2026-07-27 — all account-wide resource scope, none of those actions support resource-level restriction). The API Gateway resource (`TranslatorApi`) was given an explicit `Name` so its CloudWatch `ApiName` dimension is deterministic; passed to the Lambda as `API_GATEWAY_NAME`. `@aws-sdk/client-cost-explorer`, `@aws-sdk/client-cloudwatch`, `@aws-sdk/client-cloudwatch-logs` in `backend/package.json`.

Deployed and tested 2026-07-20: 403-for-non-OWNER confirmed, real engagement data confirmed, Cost Explorer's "not enabled" response confirmed handled gracefully (not a crash).

Both admin routes `Scan` `conversation_history` in full — fine at current scale (~100 items), but won't stay cheap or fast if usage grows into the tens of thousands of rows; revisit with a proper aggregation table or DynamoDB Streams if that happens.
