"use client";

import type { ReactNode } from "react";
import { SectionCard } from "@/components/SectionCard";
import { SignInForm } from "@/components/SignInForm";
import type { DashboardData } from "@/lib/useDashboardData";

interface DashboardPageProps<T> {
  title: string;
  /** Rendered under the title once the payload is available. */
  subtitle: (data: T | null) => ReactNode;
  signInDescription: string;
  state: DashboardData<T>;
  children: (data: T) => ReactNode;
}

/**
 * Shared OWNER-gated dashboard frame: restores the session, shows the sign-in
 * form or an access-denied card when needed, and renders the title/refresh
 * header plus loading and error states around the page body.
 */
export function DashboardPage<T>({
  title,
  subtitle,
  signInDescription,
  state,
  children,
}: DashboardPageProps<T>) {
  const { session, setSession, checkedStorage, data, error, loading, reload } = state;

  if (!checkedStorage) return null;

  if (!session) {
    return <SignInForm description={signInDescription} onSignedIn={setSession} />;
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
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle(data)}</p>
        </div>
        <button
          onClick={reload}
          className="text-sm text-brand-600 border border-brand-600 rounded-lg px-3 py-1.5"
        >
          Refresh
        </button>
      </div>

      {loading && !data && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && children(data)}
    </div>
  );
}
