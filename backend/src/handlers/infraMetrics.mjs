/**
 * Infra & security dashboard metrics — OWNER role required.
 *
 * Real: Lambda invocations, API Gateway request count, DynamoDB consumed
 * capacity, CloudWatch Logs storage (all from CloudWatch GetMetricData /
 * DescribeLogGroups), Cognito MAU (same conversation_history-based
 * computation used by dashboardMetrics.mjs), and per-service AWS cost
 * (reuses dashboardMetrics.mjs's Cost Explorer call + cache).
 *
 * Per-route "rate limit" numbers are a special case: every route in this
 * backend — including the four hottest proxy endpoints — is served through
 * one API Gateway catch-all resource (`/v1/{proxy+}` ANY), so AWS/ApiGateway's
 * own CloudWatch metrics can't tell one route's traffic from another's. The
 * counts here instead come from custom EMF metrics emitted per-request (see
 * routeMetrics.mjs), tracked only for a fixed set of routes. There's also no
 * API Gateway throttling/usage plan configured on this stack, so there is no
 * real "limit" to compare against — these are raw counts, not utilization
 * against a quota. History only exists from whenever this route first
 * deployed; counts read 0 until traffic occurs after that.
 *
 * apiKeys, sslCertificates, and cveTracking are NOT covered here — see
 * infra_security's README for why each of those needs a different approach
 * (per-provider billing APIs, ACM/custom-domain setup, and CI-time dependency
 * scanning respectively) rather than a CloudWatch query.
 */

import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getRole } from '../auth.mjs';
import { sendError, sendSuccess, handleError } from '../response.mjs';
import { getAwsCost } from './dashboardMetrics.mjs';
import { scanAllTranslations, buildUsageByUser, countActiveWithin } from '../lib/usageAnalytics.mjs';
import { ROUTE_METRICS_NAMESPACE } from '../lib/routeMetrics.mjs';

const REGION = process.env.AWS_REGION || 'us-east-1';
const cloudwatch = new CloudWatchClient({ region: REGION });
const cwLogs = new CloudWatchLogsClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });

// Must match TRACKED_ROUTES in index.mjs — that's what decides which routes
// actually get an EMF metric emitted for them.
const TRACKED_ROUTES = [
  'POST /v1/proxy/openai/chat',
  'POST /v1/proxy/openai/transcribe',
  'POST /v1/proxy/elevenlabs/tts',
  'POST /v1/translations',
];

const DAY_S = 24 * 60 * 60;

async function countCognitoUsers(userPoolId) {
  let total = 0;
  let paginationToken;
  do {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: userPoolId,
      PaginationToken: paginationToken,
      AttributesToGet: [],
    }));
    total += (result.Users || []).length;
    paginationToken = result.PaginationToken;
  } while (paginationToken);
  return total;
}

function sumValues(result, id) {
  const r = result.MetricDataResults?.find((m) => m.Id === id);
  return r?.Values?.reduce((a, b) => a + b, 0) ?? 0;
}

function maxValues(result, id) {
  const r = result.MetricDataResults?.find((m) => m.Id === id);
  return r?.Values?.length ? Math.max(...r.Values) : 0;
}

async function get30DayUsage() {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  const apiName = process.env.API_GATEWAY_NAME;
  const tableName = process.env.TRANSLATIONS_TABLE;

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 30 * DAY_S * 1000);
  const period = 30 * DAY_S; // one bucket covering the whole 30-day window

  const queries = [
    {
      Id: 'lambdaInvocations',
      MetricStat: {
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Invocations', Dimensions: [{ Name: 'FunctionName', Value: functionName }] },
        Period: period,
        Stat: 'Sum',
      },
    },
    {
      Id: 'apiRequests',
      MetricStat: {
        Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Count', Dimensions: [{ Name: 'ApiName', Value: apiName }] },
        Period: period,
        Stat: 'Sum',
      },
    },
    {
      Id: 'dynamoWrite',
      MetricStat: {
        Metric: { Namespace: 'AWS/DynamoDB', MetricName: 'ConsumedWriteCapacityUnits', Dimensions: [{ Name: 'TableName', Value: tableName }] },
        Period: period,
        Stat: 'Sum',
      },
    },
    {
      Id: 'dynamoRead',
      MetricStat: {
        Metric: { Namespace: 'AWS/DynamoDB', MetricName: 'ConsumedReadCapacityUnits', Dimensions: [{ Name: 'TableName', Value: tableName }] },
        Period: period,
        Stat: 'Sum',
      },
    },
    ...TRACKED_ROUTES.map((route, i) => ({
      Id: `route${i}`,
      MetricStat: {
        Metric: { Namespace: ROUTE_METRICS_NAMESPACE, MetricName: 'RequestCount', Dimensions: [{ Name: 'Route', Value: route }] },
        Period: period,
        Stat: 'Sum',
      },
    })),
  ];

  const result = await cloudwatch.send(new GetMetricDataCommand({ StartTime: startTime, EndTime: endTime, MetricDataQueries: queries }));

  return {
    lambdaInvocations: sumValues(result, 'lambdaInvocations'),
    apiRequests: sumValues(result, 'apiRequests'),
    dynamoWriteUnits: sumValues(result, 'dynamoWrite'),
    dynamoReadUnits: sumValues(result, 'dynamoRead'),
    routeRequests30d: TRACKED_ROUTES.map((route, i) => ({ route, requests30d: sumValues(result, `route${i}`) })),
  };
}

// Separate call with 1-minute granularity over a short recent window — asking
// for 60s buckets across a full 30 days in one query would mean tens of
// thousands of datapoints just to find a handful of peaks.
async function getRecentPeakPerRoute() {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 3 * 60 * 60 * 1000); // last 3 hours

  const queries = TRACKED_ROUTES.map((route, i) => ({
    Id: `peak${i}`,
    MetricStat: {
      Metric: { Namespace: ROUTE_METRICS_NAMESPACE, MetricName: 'RequestCount', Dimensions: [{ Name: 'Route', Value: route }] },
      Period: 60,
      Stat: 'Sum',
    },
  }));

  const result = await cloudwatch.send(new GetMetricDataCommand({ StartTime: startTime, EndTime: endTime, MetricDataQueries: queries }));
  return TRACKED_ROUTES.map((route, i) => ({ route, peakPerMinute: maxValues(result, `peak${i}`) }));
}

async function getLogGroupBytes(functionName) {
  const result = await cwLogs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: `/aws/lambda/${functionName}` }));
  return result.logGroups?.[0]?.storedBytes ?? 0;
}

function costFor(byService, keyword) {
  const match = byService.find((s) => s.service.toLowerCase().includes(keyword));
  return match ? match.costUsd : 0;
}

// GB-with-2-decimals rounds anything under ~10MB down to "0.00 GB" — useless
// at this stack's actual log volume, so pick the unit the value earns.
function formatBytes(bytes) {
  const mb = bytes / (1024 ** 2);
  if (mb < 1024) return `${mb.toFixed(2)} MB stored`;
  return `${(mb / 1024).toFixed(2)} GB stored`;
}

// ─────────────────────────────────────────────────────────
// GET /v1/admin/infra-metrics  (OWNER only)
// ─────────────────────────────────────────────────────────
export async function getInfraMetrics(event) {
  try {
    if (getRole(event) !== 'OWNER') return sendError(403, 'OWNER role required');

    const [usage, peaks, logBytes, totalMembers, translations, cost] = await Promise.all([
      get30DayUsage(),
      getRecentPeakPerRoute(),
      getLogGroupBytes(process.env.AWS_LAMBDA_FUNCTION_NAME),
      countCognitoUsers(process.env.USER_POOL_ID),
      scanAllTranslations(),
      getAwsCost(),
    ]);

    const usageByUser = buildUsageByUser(translations);
    const mau = countActiveWithin(usageByUser, 30, totalMembers);

    const peakByRoute = new Map(peaks.map((p) => [p.route, p.peakPerMinute]));

    return sendSuccess({
      generatedAt: new Date().toISOString(),
      awsResources: [
        { service: 'Lambda', metric: `${Math.round(usage.lambdaInvocations).toLocaleString()} invocations (30d)`, costUsd: costFor(cost.byService, 'lambda') },
        { service: 'API Gateway', metric: `${Math.round(usage.apiRequests).toLocaleString()} requests (30d)`, costUsd: costFor(cost.byService, 'api gateway') },
        { service: 'DynamoDB', metric: `${Math.round(usage.dynamoWriteUnits).toLocaleString()} WCU / ${Math.round(usage.dynamoReadUnits).toLocaleString()} RCU (30d)`, costUsd: costFor(cost.byService, 'dynamodb') },
        { service: 'Cognito', metric: `${mau.count.toLocaleString()} MAU`, costUsd: costFor(cost.byService, 'cognito') },
        { service: 'CloudWatch Logs', metric: formatBytes(logBytes), costUsd: costFor(cost.byService, 'cloudwatch') },
      ],
      awsCost: { available: cost.available, reason: cost.reason ?? null, totalUsd: cost.totalUsd },
      rateLimits: {
        limitsConfigured: false,
        note: 'No API Gateway throttling or usage plans exist on this stack, so there is no real limit to report — these are raw request counts from custom per-route metrics, tracked only for these 4 routes. History starts from whenever this route first deployed.',
        routes: usage.routeRequests30d.map((r) => ({
          route: r.route,
          requests30d: r.requests30d,
          peakPerMinuteLast3h: peakByRoute.get(r.route) ?? 0,
        })),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
