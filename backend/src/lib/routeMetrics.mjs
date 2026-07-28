/**
 * Per-route request counting for the infra dashboard's "API rate limits" section.
 *
 * Why this exists: every route in this backend (including the four hottest
 * proxy endpoints) shares a single API Gateway resource — `/v1/{proxy+}` ANY —
 * so AWS/ApiGateway's own CloudWatch metrics can't distinguish one route from
 * another; they only report totals for the whole catch-all. To get a real
 * per-route request count we emit CloudWatch Embedded Metric Format (EMF) log
 * lines instead. Lambda ships stdout to CloudWatch Logs automatically and
 * CloudWatch extracts EMF metrics from those log lines with no agent, no
 * extra API calls, and no per-request cost — just ordinary log delivery.
 *
 * Only a fixed, small set of routes are tracked (see index.mjs) to keep the
 * metric's dimension cardinality — and its ~$0.30/metric/month cost — low.
 */

export const ROUTE_METRICS_NAMESPACE = 'AiTranslator/Routes';

export function recordRouteRequest(route) {
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: ROUTE_METRICS_NAMESPACE,
        Dimensions: [['Route']],
        Metrics: [{ Name: 'RequestCount', Unit: 'Count' }],
      }],
    },
    Route: route,
    RequestCount: 1,
  }));
}
