"use client";

import { useState, useEffect, useCallback } from "react";
import { StatCard } from "@/components/StatCard";
import { SectionCard } from "@/components/SectionCard";
import { signIn, type Session } from "@/lib/cognitoAuth";
import { loadStoredSession, storeSession } from "@/lib/session";
import { fetchSubscriptionsOverview, type SubscriptionsOverviewResponse } from "@/lib/subscriptionsApi";

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
      <SectionCard title="Sign in" description="OWNER-role Cognito account required to view subscriptions data">
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

const ATTENTION_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  halted: "bg-red-100 text-red-700",
};

function AttentionPill({ status }: { status: string }) {
  const style = ATTENTION_STYLE[status] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}>
      {status}
    </span>
  );
}

export default function SubscriptionsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<SubscriptionsOverviewResponse | null>(null);
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
      setData(await fetchSubscriptionsOverview(s.idToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subscriptions data");
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
          <h1 className="text-xl font-semibold text-slate-900">Subscriptions</h1>
          <p className="text-sm text-slate-500">
            {data && `Generated ${new Date(data.generatedAt).toLocaleString()}`}
          </p>
        </div>
        <button
          onClick={() => session && load(session)}
          className="btn-ghost"
        >
          Refresh
        </button>
      </div>

      {loading && !data && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && !data.available && <UnavailableNote reason={data.reason || "no data source"} />}

      {data && data.available && (
        <>
          {/* ── Active subscribers + MRR, split by plan ── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Plus — active subscribers" value={data.byPlan.plus.activeCount.toLocaleString()} delta={`₹${data.byPlan.plus.mrr.toLocaleString()}/mo`} />
            <StatCard label="Live — active subscribers" value={data.byPlan.live.activeCount.toLocaleString()} delta={`₹${data.byPlan.live.mrr.toLocaleString()}/mo`} />
          </div>

          {/* ── Renewing within 7 days ── */}
          <SectionCard
            title="Renewing within 7 days"
            description="Every active subscription (plus/live) whose current billing cycle ends within the next week"
          >
            {data.expiringWithinWeek.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-4 font-medium">User</th>
                      <th className="py-2 pr-4 font-medium">Plan</th>
                      <th className="py-2 pr-4 font-medium">Renews in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expiringWithinWeek.map((u) => (
                      <tr key={u.subscriptionId} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 text-slate-700">{u.identifier}</td>
                        <td className="py-2 pr-4 text-slate-500 capitalize">{u.plan}</td>
                        <td className="py-2 pr-4 text-slate-500">{u.expiresInDays} day{u.expiresInDays === 1 ? "" : "s"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No subscriptions renewing in the next 7 days.</p>
            )}
          </SectionCard>

          {/* ── Needs attention — Razorpay is struggling to charge these ── */}
          <SectionCard
            title="Needs attention"
            description="Subscriptions Razorpay currently reports as pending or halted — a renewal charge is failing"
          >
            {data.needsAttention.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-4 font-medium">User</th>
                      <th className="py-2 pr-4 font-medium">Plan</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.needsAttention.map((u) => (
                      <tr key={u.subscriptionId} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 text-slate-700">{u.identifier}</td>
                        <td className="py-2 pr-4 text-slate-500 capitalize">{u.plan}</td>
                        <td className="py-2 pr-4">
                          <AttentionPill status={u.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No subscriptions with payment friction right now.</p>
            )}
          </SectionCard>

          {/* ── Full status breakdown (created/active/cancelled/etc.) ── */}
          <SectionCard title="Status breakdown" description="Every Razorpay subscription this account has ever created, by current status">
            <div className="flex flex-wrap gap-3">
              {Object.entries(data.statusBreakdown).map(([status, count]) => (
                <div key={status} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-xs text-slate-500 capitalize">{status}</p>
                  <p className="text-lg font-semibold text-slate-900">{count}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
