const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

export interface UserUsageRow {
  userId: string;
  identifier: string;
  status: string;
  signedUpAt: string;
  translationCount: number;
  conversationModeCount: number;
  lastActive: string | null;
  topLanguagePairs: { pair: string; count: number }[];
}

export interface UserAnalyticsResponse {
  generatedAt: string;
  totalMembers: number;
  totalTranslations: number;
  activeRates: {
    d7: { count: number; pct: number };
    d30: { count: number; pct: number };
    d90: { count: number; pct: number };
  };
  users: UserUsageRow[];
  unavailable: string[];
}

export async function fetchUserAnalytics(idToken: string): Promise<UserAnalyticsResponse> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");

  const response = await fetch(`${API_BASE}/v1/admin/user-analytics`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (response.status === 403) throw new Error("OWNER role required for this dashboard");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}
