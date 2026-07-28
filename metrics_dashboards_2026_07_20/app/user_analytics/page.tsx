"use client";

import { useState, useEffect, useCallback } from "react";
import { StatCard } from "@/components/StatCard";
import { SectionCard } from "@/components/SectionCard";
import { BarList } from "@/components/BarList";
import { signIn, type Session } from "@/lib/cognitoAuth";
import { fetchUserAnalytics, type UserAnalyticsResponse } from "@/lib/userAnalyticsApi";
import { fetchDashboardMetrics, type DashboardMetricsResponse } from "@/lib/dashboardMetricsApi";

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
      <SectionCard title="Sign in" description="OWNER-role Cognito account required to view usage data">
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
  return <p className="text-sm text-slate-500 italic">Not available yet — {reason}</p>;
}

function formatDate(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function UserAnalyticsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [usage, setUsage] = useState<UserAnalyticsResponse | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetricsResponse | null>(null);
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
      const [usageResult, metricsResult] = await Promise.all([
        fetchUserAnalytics(s.idToken),
        fetchDashboardMetrics(s.idToken),
      ]);
      setUsage(usageResult);
      setMetrics(metricsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
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
          <h1 className="text-xl font-semibold text-slate-900">User Analytics</h1>
          <p className="text-sm text-slate-500">
            {metrics && `Generated ${new Date(metrics.generatedAt).toLocaleString()}`}
          </p>
        </div>
        <button
          onClick={() => session && load(session)}
          className="text-sm text-brand-600 border border-brand-600 rounded-lg px-3 py-1.5"
        >
          Refresh
        </button>
      </div>

      {loading && !metrics && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {metrics && usage && (
        <>
          {/* ── 1. Revenue ── */}
          <SectionCard title="Revenue" description="By product tier">
            {metrics.revenue.available ? (
              <>
                <p className="text-2xl font-semibold text-slate-900 mb-4">
                  ${metrics.revenue.totalUsd?.toLocaleString()}
                </p>
                <BarList items={metrics.revenue.byTier.map((t) => ({ label: t.tier, value: t.totalUsd }))} />
              </>
            ) : (
              <UnavailableNote reason={metrics.revenue.reason || "no data source"} />
            )}
          </SectionCard>

          {/* ── 2. Engagement (WAU / MAU) ── */}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total members" value={metrics.engagement.totalMembers.toLocaleString()} />
            <StatCard
              label="WAU (7-day)"
              value={metrics.engagement.wau.count.toLocaleString()}
              delta={`${metrics.engagement.wau.pct}% of members`}
            />
            <StatCard
              label="MAU (30-day)"
              value={metrics.engagement.mau.count.toLocaleString()}
              delta={`${metrics.engagement.mau.pct}% of members`}
            />
          </div>

          {/* ── 3. AWS Cost ── */}
          <SectionCard
            title="AWS cost"
            description={
              metrics.awsCost.available && metrics.awsCost.periodStart
                ? `${metrics.awsCost.periodStart} → ${metrics.awsCost.periodEnd} · live from Cost Explorer`
                : undefined
            }
          >
            {metrics.awsCost.available ? (
              <>
                <p className="text-2xl font-semibold text-slate-900 mb-4">
                  ${metrics.awsCost.totalUsd?.toFixed(2)}
                </p>
                {metrics.awsCost.byService.length > 0 ? (
                  <BarList items={metrics.awsCost.byService.map((s) => ({ label: s.service, value: s.costUsd }))} />
                ) : (
                  <p className="text-sm text-slate-500">No billed services in the current period yet.</p>
                )}
              </>
            ) : (
              <UnavailableNote reason={metrics.awsCost.reason || "Cost Explorer unavailable"} />
            )}
          </SectionCard>

          {/* ── 4. Churn — expiring in 7-14 days ── */}
          <SectionCard title="Churn" description="Subscriptions expiring in 7–14 days">
            {metrics.churn.available ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-4 font-medium">User</th>
                      <th className="py-2 pr-4 font-medium">Expires in</th>
                      <th className="py-2 pr-4 font-medium">Renewal notification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.churn.users.map((u) => (
                      <tr key={u.userId} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 text-slate-700">{u.identifier}</td>
                        <td className="py-2 pr-4 text-slate-500">{u.expiresInDays} days</td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              u.renewalNotificationSent
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {u.renewalNotificationSent ? "Sent" : "Pending"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <UnavailableNote reason={metrics.churn.reason || "no data source"} />
            )}
          </SectionCard>

          {/* ── Usage by user (real, from conversation_history + Cognito) ── */}
          <SectionCard title="Usage by user" description={`${usage.totalTranslations} translations across ${usage.totalMembers} members`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4 font-medium">User</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Signed up</th>
                    <th className="py-2 pr-4 font-medium">Translations</th>
                    <th className="py-2 pr-4 font-medium">Conversation mode</th>
                    <th className="py-2 pr-4 font-medium">Last active</th>
                    <th className="py-2 pr-4 font-medium">Top language pairs</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.users.map((u) => (
                    <tr key={u.userId} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 text-slate-700">{u.identifier}</td>
                      <td className="py-2 pr-4 text-slate-500">{u.status}</td>
                      <td className="py-2 pr-4 text-slate-500">{formatDate(u.signedUpAt)}</td>
                      <td className="py-2 pr-4 text-slate-700 font-medium">{u.translationCount}</td>
                      <td className="py-2 pr-4 text-slate-500">{u.conversationModeCount}</td>
                      <td className="py-2 pr-4 text-slate-500">{formatDate(u.lastActive)}</td>
                      <td className="py-2 pr-4 text-slate-500">
                        {u.topLanguagePairs.length
                          ? u.topLanguagePairs.map((p) => `${p.pair} (${p.count})`).join(", ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
