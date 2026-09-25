import Link from "next/link";
import { Users, ShieldCheck, CreditCard, ArrowUpRight } from "lucide-react";

const TILES = [
  {
    href: "/user_analytics",
    icon: Users,
    title: "User Analytics",
    description: "Members, regions, retention, churn risk",
    from: "from-brand-500",
    to: "to-brand-700",
  },
  {
    href: "/payments",
    icon: CreditCard,
    title: "Payments",
    description: "Active paying users, recent orders (live from Razorpay)",
    from: "from-accent-500",
    to: "to-brand-600",
  },
  {
    href: "/infra_security",
    icon: ShieldCheck,
    title: "Infra & Security",
    description: "Keys, AWS cost, SSL, rate limits, CVEs",
    from: "from-brand-600",
    to: "to-accent-600",
  },
];

export default function Home() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pick a dashboard to dive into.</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {TILES.map(({ href, icon: Icon, title, description, from, to }) => (
          <Link key={href} href={href} className="card group relative overflow-hidden p-6">
            <span
              className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${from} ${to} text-white shadow-sm`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="flex items-center gap-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
              {title}
              <ArrowUpRight className="h-4 w-4 text-slate-300 dark:text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand-500 dark:group-hover:text-brand-400" />
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
