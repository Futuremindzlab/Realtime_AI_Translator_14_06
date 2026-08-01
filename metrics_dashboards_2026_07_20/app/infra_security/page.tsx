"use client";

import { useCallback } from "react";
import { StatCard } from "@/components/StatCard";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge, type Status } from "@/components/StatusBadge";
import { DashboardPage } from "@/components/DashboardPage";
import { useDashboardData } from "@/lib/useDashboardData";
import type { Session } from "@/lib/cognitoAuth";
import { fetchInfraMetrics, type InfraMetricsResponse } from "@/lib/infraMetricsApi";
import { apiKeys, sslCertificates, cveTracking } from "@/lib/mockInfraSecurity";

const keyStatus: Record<string, Status> = { active: "ok", warning: "warning", critical: "critical" };
const severityStatus: Record<string, Status> = { low: "ok", medium: "warning", high: "critical" };

const attentionCerts = sslCertificates.filter((c) => c.status !== "ok").length;
const openCves = cveTracking.filter((c) => c.status === "pending").length;

export default function InfraSecurityPage() {
  const load = useCallback((s: Session) => fetchInfraMetrics(s.idToken), []);
  const state = useDashboardData<InfraMetricsResponse>(load, "Failed to load infra metrics");

  return (
    <DashboardPage
      title="Infra & Security"
      signInDescription="OWNER-role Cognito account required to view infra data"
      state={state}
      subtitle={(metrics) =>
        metrics
          ? `Generated ${new Date(metrics.generatedAt).toLocaleString()} — AWS usage/cost and route requests are live; API keys, SSL, and CVEs below are still mock`
          : "Loading…"
      }
    >
      {(metrics) => {
        const totalAwsCost = metrics.awsResources.reduce((sum, r) => sum + r.costUsd, 0);

        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Monthly AWS cost" value={`$${totalAwsCost.toFixed(2)}`} />
              <StatCard label="Active API keys" value={apiKeys.length.toString()} />
              <StatCard
                label="Certs needing attention"
                value={attentionCerts.toString()}
                deltaTone={attentionCerts > 0 ? "down" : "neutral"}
              />
              <StatCard label="Open CVEs" value={openCves.toString()} deltaTone={openCves > 0 ? "down" : "neutral"} />
            </div>

            <SectionCard title="API keys & subscriptions" description="OpenAI, ElevenLabs, Azure, Razorpay — mock, not yet wired">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 font-medium">Provider</th>
                    <th className="py-2 font-medium">Label</th>
                    <th className="py-2 font-medium">Plan</th>
                    <th className="py-2 font-medium">Usage / renewal</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((k) => (
                    <tr key={`${k.provider}-${k.label}`} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 text-slate-700">{k.provider}</td>
                      <td className="py-2 text-slate-500">{k.label}</td>
                      <td className="py-2 text-slate-500">{k.plan}</td>
                      <td className="py-2 text-slate-500">{k.renewsOrChecked}</td>
                      <td className="py-2">
                        <StatusBadge status={keyStatus[k.status]} label={k.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>

            <SectionCard
              title="AWS resource usage & cost"
              description={
                metrics.awsCost.available
                  ? "Usage: live from CloudWatch (30d) · Cost: live from Cost Explorer"
                  : `Usage: live from CloudWatch (30d) · Cost: ${metrics.awsCost.reason || "Cost Explorer unavailable"}`
              }
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 font-medium">Service</th>
                    <th className="py-2 font-medium">Usage (30d)</th>
                    <th className="py-2 font-medium">Monthly cost</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.awsResources.map((r) => (
                    <tr key={r.service} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 text-slate-700">{r.service}</td>
                      <td className="py-2 text-slate-500">{r.metric}</td>
                      <td className="py-2 text-slate-500">${r.costUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>

            <div className="grid gap-6 lg:grid-cols-2">
              <SectionCard title="SSL certificate expiry" description="Mock — no custom domain configured yet">
                <ul className="space-y-3">
                  {sslCertificates.map((c) => (
                    <li key={c.domain} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="text-slate-700">{c.domain}</p>
                        <p className="text-slate-500 text-xs">
                          {c.issuer} · expires in {c.expiresIn}
                        </p>
                      </div>
                      <StatusBadge status={c.status as Status} label={c.status} />
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard title="API request counts" description={metrics.rateLimits.note}>
                <div className="space-y-3">
                  {metrics.rateLimits.routes.map((r) => (
                    <div key={r.route}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-700 font-mono text-xs">{r.route}</span>
                        <span className="text-slate-500">
                          {r.requests30d.toLocaleString()} (30d) · peak {r.peakPerMinuteLast3h}/min
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Vulnerability & CVE tracking" description="Mock — dependency patch status (needs CI-time scanning, not a runtime API)">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 font-medium">Package</th>
                    <th className="py-2 font-medium">Version</th>
                    <th className="py-2 font-medium">CVE</th>
                    <th className="py-2 font-medium">Severity</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cveTracking.map((c) => (
                    <tr key={c.cve} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 text-slate-700">{c.package}</td>
                      <td className="py-2 text-slate-500 font-mono text-xs">{c.version}</td>
                      <td className="py-2 text-slate-500 font-mono text-xs">{c.cve}</td>
                      <td className="py-2">
                        <StatusBadge status={severityStatus[c.severity]} label={c.severity} />
                      </td>
                      <td className="py-2 text-slate-500 capitalize">{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          </>
        );
      }}
    </DashboardPage>
  );
}
