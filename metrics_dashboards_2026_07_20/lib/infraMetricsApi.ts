import { fetchAdminJson } from "@/lib/adminApi";

export interface AwsResourceRow {
  service: string;
  metric: string;
  costUsd: number;
}

export interface InfraAwsCost {
  available: boolean;
  reason?: string | null;
  totalUsd: number | null;
}

export interface RouteRateRow {
  route: string;
  requests30d: number;
  peakPerMinuteLast3h: number;
}

export interface RateLimits {
  limitsConfigured: boolean;
  note: string;
  routes: RouteRateRow[];
}

export interface InfraMetricsResponse {
  generatedAt: string;
  awsResources: AwsResourceRow[];
  awsCost: InfraAwsCost;
  rateLimits: RateLimits;
}

export function fetchInfraMetrics(idToken: string): Promise<InfraMetricsResponse> {
  return fetchAdminJson<InfraMetricsResponse>("/v1/admin/infra-metrics", idToken);
}
