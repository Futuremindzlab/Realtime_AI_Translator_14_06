const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

export interface TranslationRow {
  id: string;
  timestamp: string;
  source_language: string;
  target_language: string;
  source_text: string;
  translated_text: string;
  conversation_mode: boolean;
  created_at: string;
}

export interface MyTranslationsResponse {
  items: TranslationRow[];
  count: number;
  nextKey: string | null;
}

// Caller's own translation history only — GET /v1/translations scopes by
// the Cognito sub in the token, same table the app itself reads/writes to.
export async function fetchMyTranslations(idToken: string): Promise<MyTranslationsResponse> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");

  const response = await fetch(`${API_BASE}/v1/translations?limit=50`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

export interface MyPaymentRow {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  plan: string | null;
  createdAt: string;
}

export interface MyBillingHistoryResponse {
  available: boolean;
  reason?: string;
  items: MyPaymentRow[];
}

// Caller's own payment history only — GET /v1/billing/history filters
// Razorpay payments down to notes.user_id === the caller's own sub.
export async function fetchMyBillingHistory(idToken: string): Promise<MyBillingHistoryResponse> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");

  const response = await fetch(`${API_BASE}/v1/billing/history`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}
