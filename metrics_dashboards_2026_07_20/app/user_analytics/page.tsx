"use client";

import { useCallback } from "react";
import { StatCard } from "@/components/StatCard";
import { SectionCard } from "@/components/SectionCard";
import { BarList } from "@/components/BarList";
import { DashboardPage } from "@/components/DashboardPage";
import { useDashboardData } from "@/lib/useDashboardData";
import type { Session } from "@/lib/cognitoAuth";
import { fetchUserAnalytics, type UserAnalyticsResponse } from "@/lib/userAnalyticsApi";
import { fetchDashboardMetrics, type DashboardMetricsResponse } from "@/lib/dashboardMetricsApi";

interface AnalyticsData {
  usage: UserAnalyticsResponse;
  metrics: DashboardMetricsResponse;
}

function UnavailableNote({ reason }: { reason: string }) {
  return <p className="text-sm text-slate-500 italic">Not available yet — {reason}</p>;
}

function formatDate(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function UserAnalyticsPage() {
  const load = useCallback(async (s: Session): Promise<AnalyticsData> => {
    const [usage, metrics] = await Promise.all([
      fetchUserAnalytics(s.idToken),
      fetchDashboardMetrics(s.idToken),
    ]);
    return { usage, metrics };
  }, []);
  const state = useDashboardData<AnalyticsData>(load, "Failed to load analytics");

  return (
    <DashboardPage
      title="User Analytics"
      signInDescription="OWNER-role Cognito account required to view usage data"
      state={state}
      subtitle={(data) => data && `Generated ${new Date(data.metrics.generatedAt).toLocaleString()}`}
    >
      {({ usage, metrics }) => (
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
    </DashboardPage>
  );
}
