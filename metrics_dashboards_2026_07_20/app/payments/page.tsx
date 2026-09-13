"use client";

import { useState, useEffect, useCallback } from "react";
import { SectionCard } from "@/components/SectionCard";
import { signIn, type Session } from "@/lib/cognitoAuth";
import { fetchPaymentsOverview, type PaymentsOverviewResponse } from "@/lib/paymentsApi";

const SESSION_KEY = "ops_dashboard_session";

function loadStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

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
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      onSignedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-16">
      <SectionCard title="Sign in" description="OWNER-role Cognito account required to view payments data">
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 text-white text-sm font-medium py-2 disabled:opacity-50"
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

const STATUS_STYLE: Record<string, string> = {
  captured: "bg-emerald-100 text-emerald-700",
  authorized: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  refunded: "bg-slate-200 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  cancel_requested: "bg-amber-100 text-amber-700",
  cancelled: "bg-slate-200 text-slate-700",
  halted: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const style = STATUS_STYLE[status] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function PaymentsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<PaymentsOverviewResponse | null>(null);
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
      setData(await fetchPaymentsOverview(s.idToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments data");
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

  if (session.role !== "OWNER") {
    return (
      <div className="max-w-sm mx-auto mt-16">
        <SectionCard title="Access restricted">
          <p className="text-sm text-slate-600">
            Signed in as {session.email}, but this dashboard requires the OWNER role.
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Payments</h1>
          <p className="text-sm text-slate-500">
            {data && `Generated ${new Date(data.generatedAt).toLocaleString()}`}
          </p>
        </div>
        <button
          onClick={() => session && load(session)}
          className="text-sm text-brand-600 border border-brand-600 rounded-lg px-3 py-1.5"
        >
          Refresh
        </button>
      </div>

      {loading && !data && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && (
        <>
          {/* ── Active users by plan ── */}
          <SectionCard
            title="Active paying users"
            description={`${data.activeUsers.length} user${data.activeUsers.length === 1 ? "" : "s"} on a paid plan`}
          >
            {data.activeUsers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-4 font-medium">User</th>
                      <th className="py-2 pr-4 font-medium">Plan</th>
                      <th className="py-2 pr-4 font-medium">Subscription status</th>
                      <th className="py-2 pr-4 font-medium">Last updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activeUsers.map((u) => (
                      <tr key={u.userId} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 text-slate-700">{u.identifier}</td>
                        <td className="py-2 pr-4 text-slate-500 capitalize">{u.plan}</td>
                        <td className="py-2 pr-4">
                          <StatusPill status={u.subscriptionStatus} />
                        </td>
                        <td className="py-2 pr-4 text-slate-500">{formatDateTime(u.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No users on a paid plan yet.</p>
            )}
          </SectionCard>

          {/* ── Recent orders — live from Razorpay, not stored locally ── */}
          <SectionCard title="Recent orders" description="Live from Razorpay — most recent first, not cached">
            {data.orders.available ? (
              data.orders.items.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-2 pr-4 font-medium">Payment ID</th>
                        <th className="py-2 pr-4 font-medium">Amount</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                        <th className="py-2 pr-4 font-medium">Method</th>
                        <th className="py-2 pr-4 font-medium">Plan</th>
                        <th className="py-2 pr-4 font-medium">Contact</th>
                        <th className="py-2 pr-4 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.items.map((o) => (
                        <tr key={o.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-4 text-slate-700 font-mono text-xs">{o.id}</td>
                          <td className="py-2 pr-4 text-slate-700">
                            ₹{o.amount.toLocaleString()} {o.currency !== "INR" && o.currency}
                          </td>
                          <td className="py-2 pr-4">
                            <StatusPill status={o.status} />
                          </td>
                          <td className="py-2 pr-4 text-slate-500">{o.method || "—"}</td>
                          <td className="py-2 pr-4 text-slate-500 capitalize">{o.plan || "—"}</td>
                          <td className="py-2 pr-4 text-slate-500">{o.email || o.contact || "—"}</td>
                          <td className="py-2 pr-4 text-slate-500">{formatDateTime(o.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No orders yet.</p>
              )
            ) : (
              <UnavailableNote reason={data.orders.reason || "no data source"} />
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
