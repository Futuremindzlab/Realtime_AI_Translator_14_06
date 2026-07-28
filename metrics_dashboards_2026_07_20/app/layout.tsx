import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Metrics Dashboards",
  description: "Internal analytics and infra/security dashboards",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <nav className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-6">
          <span className="font-semibold text-slate-900">Metrics Dashboards</span>
          <a href="/user_analytics" className="text-sm text-slate-600 hover:text-brand-600">
            User Analytics
          </a>
          <a href="/infra_security" className="text-sm text-slate-600 hover:text-brand-600">
            Infra &amp; Security
          </a>
        </nav>
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
