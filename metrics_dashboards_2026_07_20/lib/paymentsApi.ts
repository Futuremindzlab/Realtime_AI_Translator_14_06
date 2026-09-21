const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

export interface ActiveUserRow {
  userId: string;
  identifier: string;
  plan: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  updatedAt: string;
}

export interface OrderRow {
  id: string;
  orderId: string | null;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  email: string | null;
  contact: string | null;
  plan: string | null;
  userId: string | null;
  createdAt: string;
}

export interface OrdersSection {
  available: boolean;
  reason?: string;
  items: OrderRow[];
}

export interface PaymentsOverviewResponse {
  generatedAt: string;
  activeUsers: ActiveUserRow[];
  orders: OrdersSection;
}

export async function fetchPaymentsOverview(idToken: string): Promise<PaymentsOverviewResponse> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");

  const response = await fetch(`${API_BASE}/v1/admin/payments`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (response.status === 403) throw new Error("OWNER role required for this dashboard");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}
