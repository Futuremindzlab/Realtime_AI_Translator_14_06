const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

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

export async function fetchInfraMetrics(idToken: string): Promise<InfraMetricsResponse> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");

  const response = await fetch(`${API_BASE}/v1/admin/infra-metrics`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (response.status === 403) throw new Error("OWNER role required for this dashboard");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}
