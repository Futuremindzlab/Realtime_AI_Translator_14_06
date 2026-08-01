import { fetchAdminJson } from "@/lib/adminApi";

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

export function fetchDashboardMetrics(idToken: string): Promise<DashboardMetricsResponse> {
  return fetchAdminJson<DashboardMetricsResponse>("/v1/admin/dashboard-metrics", idToken);
}
