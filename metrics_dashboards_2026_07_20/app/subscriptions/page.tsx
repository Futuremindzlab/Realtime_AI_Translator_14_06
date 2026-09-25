"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Radio, Clock, CalendarClock, UserPlus, CalendarPlus } from "lucide-react";
import { MetricTile } from "@/components/MetricTile";
import { SectionCard } from "@/components/SectionCard";
import { SignInForm } from "@/components/SignInForm";
import type { Session } from "@/lib/cognitoAuth";
import { loadStoredSession } from "@/lib/session";
import { fetchSubscriptionsOverview, type SubscriptionsOverviewResponse } from "@/lib/subscriptionsApi";

function UnavailableNote({ reason }: { reason: string }) {
  return <p className="text-sm text-slate-500 dark:text-slate-400 italic">Not available — {reason}</p>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const ATTENTION_STYLE: Record<string, string> = {
  pending: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400",
  halted: "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400",
};

function AttentionPill({ status }: { status: string }) {
  const style = ATTENTION_STYLE[status] || "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400";
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
    return (
      <SignInForm
        description="OWNER-role Cognito account required to view subscriptions data"
        onSignedIn={setSession}
      />
    );
  }

  if (session.role !== "OWNER") {
    return (
      <div className="max-w-sm mx-auto mt-16">
        <SectionCard title="Access restricted">
          <p className="text-sm text-slate-600 dark:text-slate-400">
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
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Subscriptions</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
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

      {loading && !data && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {data && !data.available && <UnavailableNote reason={data.reason || "no data source"} />}

      {data && data.available && (
        <>
          {/* ── At-a-glance overview row — horizontal, like the homepage tiles,
               instead of the narrow vertical stack this used to be. ── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <MetricTile
              icon={Users}
              label="Plus — active"
              value={data.byPlan.plus.activeCount.toLocaleString()}
              sublabel={`₹${data.byPlan.plus.mrr.toLocaleString()}/mo`}
              from="from-brand-500"
              to="to-brand-700"
            />
            <MetricTile
              icon={Radio}
              label="Live — active"
              value={data.byPlan.live.activeCount.toLocaleString()}
              sublabel={`₹${data.byPlan.live.mrr.toLocaleString()}/mo`}
              from="from-accent-500"
              to="to-brand-600"
            />
            <MetricTile
              icon={Clock}
              label="Expiring this week"
              value={data.expiringWithinWeek.length.toLocaleString()}
              from="from-amber-500"
              to="to-orange-600"
            />
            <MetricTile
              icon={CalendarClock}
              label="Expiring this month"
              value={data.expiringWithinMonthCount.toLocaleString()}
              from="from-amber-400"
              to="to-amber-600"
            />
            <MetricTile
              icon={UserPlus}
              label="New this week"
              value={data.newSubscriptionsLastWeekCount.toLocaleString()}
              from="from-emerald-500"
              to="to-teal-600"
            />
            <MetricTile
              icon={CalendarPlus}
              label="New this month"
              value={data.newSubscriptionsLastMonthCount.toLocaleString()}
              from="from-emerald-400"
              to="to-emerald-600"
            />
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
                    <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 pr-4 font-medium">User</th>
                      <th className="py-2 pr-4 font-medium">Plan</th>
                      <th className="py-2 pr-4 font-medium">Renews in</th>
                      <th className="py-2 pr-4 font-medium">Expiry date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expiringWithinWeek.map((u) => (
                      <tr key={u.subscriptionId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{u.identifier}</td>
                        <td className="py-2 pr-4 text-slate-500 dark:text-slate-400 capitalize">{u.plan}</td>
                        <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{u.expiresInDays} day{u.expiresInDays === 1 ? "" : "s"}</td>
                        <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{formatDate(u.expiresAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No subscriptions renewing in the next 7 days.</p>
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
                    <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 pr-4 font-medium">User</th>
                      <th className="py-2 pr-4 font-medium">Plan</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.needsAttention.map((u) => (
                      <tr key={u.subscriptionId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{u.identifier}</td>
                        <td className="py-2 pr-4 text-slate-500 dark:text-slate-400 capitalize">{u.plan}</td>
                        <td className="py-2 pr-4">
                          <AttentionPill status={u.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No subscriptions with payment friction right now.</p>
            )}
          </SectionCard>

          {/* ── Full status breakdown (created/active/cancelled/etc.) ── */}
          <SectionCard title="Status breakdown" description="Every Razorpay subscription this account has ever created, by current status">
            <div className="flex flex-wrap gap-3">
              {Object.entries(data.statusBreakdown).map(([status, count]) => (
                <div key={status} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">{status}</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">{count}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
