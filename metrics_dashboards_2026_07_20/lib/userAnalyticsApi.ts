import { fetchAdminJson } from "@/lib/adminApi";

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

export function fetchUserAnalytics(idToken: string): Promise<UserAnalyticsResponse> {
  return fetchAdminJson<UserAnalyticsResponse>("/v1/admin/user-analytics", idToken);
}
