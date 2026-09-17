import type { Session } from "./cognitoAuth";

export type { Session };

// Shared by every dashboard page (payments, user_analytics, infra_security,
// subscriptions, my-history) — was duplicated verbatim in each page before
// this file existed.
export const SESSION_KEY = "ops_dashboard_session";

export function loadStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function storeSession(session: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
