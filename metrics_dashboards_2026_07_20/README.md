# Metrics Dashboards (started 2026-07-20)

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
    components/                  shared StatCard, SectionCard, BarList, DonutChart, StatusBadge
    lib/
      cognitoAuth.ts             Cognito sign-in (amazon-cognito-identity-js)
      userAnalyticsApi.ts        fetch wrapper for /v1/admin/user-analytics
      dashboardMetricsApi.ts     fetch wrapper for /v1/admin/dashboard-metrics
      infraMetricsApi.ts         fetch wrapper for /v1/admin/infra-metrics
      mockInfraSecurity.ts       mock data for the still-unwired parts of the infra board (keys, SSL, CVEs)

## Backend

Three admin routes, all OWNER-only, all in the main `TranslatorFunction` Lambda:

- `backend/src/handlers/adminAnalytics.mjs` — per-user usage table (`/v1/admin/user-analytics`).
- `backend/src/handlers/dashboardMetrics.mjs` — Revenue/Engagement/AWS Cost/Churn (`/v1/admin/dashboard-metrics`).
- `backend/src/handlers/infraMetrics.mjs` — AWS resource usage/cost + per-route request counts (`/v1/admin/infra-metrics`, added 2026-07-27).
- `backend/src/lib/usageAnalytics.mjs` — shared `conversation_history` scan + per-user aggregation used by all three.
- `backend/src/lib/routeMetrics.mjs` — emits the CloudWatch EMF per-route request metric (added 2026-07-27); `index.mjs`'s `TRACKED_ROUTES` decides which 4 routes get counted.

IAM additions in `backend/template.yaml`: `cognito-idp:ListUsers` (CognitoAdminPolicy), `ce:GetCostAndUsage` (CostExplorerPolicy), and `cloudwatch:GetMetricData` + `logs:DescribeLogGroups` (new `InfraMetricsPolicy`, added 2026-07-27 — all account-wide resource scope, none of those actions support resource-level restriction). The API Gateway resource (`TranslatorApi`) was given an explicit `Name` so its CloudWatch `ApiName` dimension is deterministic; passed to the Lambda as `API_GATEWAY_NAME`. `@aws-sdk/client-cost-explorer`, `@aws-sdk/client-cloudwatch`, `@aws-sdk/client-cloudwatch-logs` in `backend/package.json`.

Deployed and tested 2026-07-20: 403-for-non-OWNER confirmed, real engagement data confirmed, Cost Explorer's "not enabled" response confirmed handled gracefully (not a crash).

Both admin routes `Scan` `conversation_history` in full — fine at current scale (~100 items), but won't stay cheap or fast if usage grows into the tens of thousands of rows; revisit with a proper aggregation table or DynamoDB Streams if that happens.
