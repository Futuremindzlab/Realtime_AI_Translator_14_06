import type { Session } from "@/lib/cognitoAuth";

const SESSION_KEY = "ops_dashboard_session";

export function loadStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function storeSession(session: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
