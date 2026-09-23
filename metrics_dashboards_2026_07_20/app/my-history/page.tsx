"use client";

import { useState, useEffect, useCallback } from "react";
import { SectionCard } from "@/components/SectionCard";
import { signIn, type Session } from "@/lib/cognitoAuth";
import { loadStoredSession, storeSession, clearStoredSession } from "@/lib/session";
import {
  fetchMyTranslations,
  fetchMyBillingHistory,
  type MyTranslationsResponse,
  type MyBillingHistoryResponse,
} from "@/lib/myHistoryApi";

// Any signed-in account may view this page — unlike the OWNER-only
// dashboards (payments, subscriptions, user_analytics, infra_security),
// this one shows the caller's OWN data only. The backend enforces that
// scoping (GET /v1/translations and GET /v1/billing/history both key off
// the Cognito sub in the token) — there is no client-side role check here
// to bypass, since every account, OWNER or USER, only ever gets its own rows back.

function SignInForm({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await signIn(email, password);
      storeSession(session);
      onSignedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-16">
      <SectionCard title="Sign in" description="Sign in with your OneLingo account to view your own history">
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </SectionCard>
    </div>
  );
}

function UnavailableNote({ reason }: { reason: string }) {
  return <p className="text-sm text-slate-500 italic">Not available — {reason}</p>;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAYMENT_STATUS_STYLE: Record<string, string> = {
  captured: "bg-emerald-100 text-emerald-700",
  authorized: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  refunded: "bg-slate-200 text-slate-700",
};

function StatusPill({ status }: { status: string }) {
  const style = PAYMENT_STATUS_STYLE[status] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}>
      {status}
    </span>
  );
}

export default function MyHistoryPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [translations, setTranslations] = useState<MyTranslationsResponse | null>(null);
  const [billing, setBilling] = useState<MyBillingHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedStorage, setCheckedStorage] = useState(false);

  useEffect(() => {
    setSession(loadStoredSession());
    setCheckedStorage(true);
  }, []);

  const load = useCallback(async (s: Session) => {
    setLoading(true);
    setError(null);
    try {
      const [translationsResult, billingResult] = await Promise.all([
        fetchMyTranslations(s.idToken),
        fetchMyBillingHistory(s.idToken),
      ]);
      setTranslations(translationsResult);
      setBilling(billingResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) load(session);
  }, [session, load]);

  if (!checkedStorage) return null;

  if (!session) {
    return <SignInForm onSignedIn={setSession} />;
  }

  const signOut = () => {
    clearStoredSession();
    setSession(null);
    setTranslations(null);
    setBilling(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">My history</h1>
          <p className="text-sm text-slate-500">Signed in as {session.email}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => session && load(session)}
            className="btn-ghost"
          >
            Refresh
          </button>
          <button
            onClick={signOut}
            className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5"
          >
            Sign out
          </button>
        </div>
      </div>

      {loading && !translations && !billing && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {translations && (
        <SectionCard
          title="Translation history"
          description={`${translations.count} translation${translations.count === 1 ? "" : "s"}${translations.nextKey ? " (showing most recent 50)" : ""}`}
        >
          {translations.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">Languages</th>
                    <th className="py-2 pr-4 font-medium">Source</th>
                    <th className="py-2 pr-4 font-medium">Translation</th>
                    <th className="py-2 pr-4 font-medium">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {translations.items.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100 last:border-0 align-top">
                      <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{formatDateTime(t.created_at)}</td>
                      <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">
                        {t.source_language} → {t.target_language}
                      </td>
                      <td className="py-2 pr-4 text-slate-700 max-w-xs truncate" title={t.source_text}>{t.source_text}</td>
                      <td className="py-2 pr-4 text-slate-700 max-w-xs truncate" title={t.translated_text}>{t.translated_text}</td>
                      <td className="py-2 pr-4 text-slate-500">{t.conversation_mode ? "Conversation" : "Single"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No translations yet.</p>
          )}
        </SectionCard>
      )}

      {billing && (
        <SectionCard title="Billing history" description="Your own payments only">
          {billing.available ? (
            billing.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 pr-4 font-medium">Plan</th>
                      <th className="py-2 pr-4 font-medium">Amount</th>
                      <th className="py-2 pr-4 font-medium">Method</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.items.map((p) => (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 text-slate-500">{formatDateTime(p.createdAt)}</td>
                        <td className="py-2 pr-4 text-slate-500 capitalize">{p.plan || "—"}</td>
                        <td className="py-2 pr-4 text-slate-700">
                          ₹{p.amount.toLocaleString()} {p.currency !== "INR" && p.currency}
                        </td>
                        <td className="py-2 pr-4 text-slate-500">{p.method || "—"}</td>
                        <td className="py-2 pr-4">
                          <StatusPill status={p.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No payments yet.</p>
            )
          ) : (
            <UnavailableNote reason={billing.reason || "no data source"} />
          )}
        </SectionCard>
      )}
    </div>
  );
}
