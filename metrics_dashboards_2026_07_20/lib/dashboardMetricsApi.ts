const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

export interface RevenueMetric {
  available: boolean;
  reason?: string;
  totalUsd: number | null;
  byTier: { tier: string; totalUsd: number }[];
}

export interface EngagementMetric {
  available: boolean;
  totalMembers: number;
  wau: { count: number; pct: number };
  mau: { count: number; pct: number };
}

export interface AwsCostMetric {
  available: boolean;
  reason?: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalUsd: number | null;
  byService: { service: string; costUsd: number }[];
}

export interface ChurnUser {
  userId: string;
  identifier: string;
  expiresInDays: number;
  renewalNotificationSent: boolean;
}

export interface ChurnMetric {
  available: boolean;
  reason?: string;
  users: ChurnUser[];
}

export interface DashboardMetricsResponse {
  generatedAt: string;
  revenue: RevenueMetric;
  engagement: EngagementMetric;
  awsCost: AwsCostMetric;
  churn: ChurnMetric;
}

export async function fetchDashboardMetrics(idToken: string): Promise<DashboardMetricsResponse> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");

  const response = await fetch(`${API_BASE}/v1/admin/dashboard-metrics`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (response.status === 403) throw new Error("OWNER role required for this dashboard");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}
