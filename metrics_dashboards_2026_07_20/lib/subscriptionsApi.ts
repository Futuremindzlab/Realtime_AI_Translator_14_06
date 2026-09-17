const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

export interface PlanBreakdown {
  activeCount: number;
  mrr: number;
}

export interface ExpiringSubscription {
  userId: string | null;
  identifier: string;
  plan: string;
  subscriptionId: string;
  expiresInDays: number;
}

export interface AttentionSubscription {
  userId: string | null;
  identifier: string;
  plan: string;
  subscriptionId: string;
  status: string;
}

export interface SubscriptionsOverviewResponse {
  generatedAt: string;
  available: boolean;
  reason?: string;
  byPlan: { plus: PlanBreakdown; live: PlanBreakdown };
  statusBreakdown: Record<string, number>;
  expiringWithinWeek: ExpiringSubscription[];
  needsAttention: AttentionSubscription[];
}

export async function fetchSubscriptionsOverview(idToken: string): Promise<SubscriptionsOverviewResponse> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");

  const response = await fetch(`${API_BASE}/v1/admin/subscriptions`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (response.status === 403) throw new Error("OWNER role required for this dashboard");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}
