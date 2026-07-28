import Link from "next/link";
import { Users, ShieldCheck } from "lucide-react";

export default function Home() {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <Link
        href="/user_analytics"
        className="rounded-xl border border-slate-200 bg-white p-6 hover:shadow-md transition-shadow"
      >
        <Users className="h-8 w-8 text-brand-600 mb-3" />
        <h2 className="text-lg font-semibold">User Analytics</h2>
        <p className="text-sm text-slate-600 mt-1">Members, regions, retention, churn risk</p>
      </Link>
      <Link
        href="/infra_security"
        className="rounded-xl border border-slate-200 bg-white p-6 hover:shadow-md transition-shadow"
      >
        <ShieldCheck className="h-8 w-8 text-brand-600 mb-3" />
        <h2 className="text-lg font-semibold">Infra &amp; Security</h2>
        <p className="text-sm text-slate-600 mt-1">Keys, AWS cost, SSL, rate limits, CVEs</p>
      </Link>
    </div>
  );
}
