"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AdminActionProvider } from "@/components/admin/admin-actions";
import { FullPageLoading } from "@/components/app-shell";
import { Brand } from "@/components/brand";
import { useMe } from "@/components/me-provider";
import { Badge, ButtonLink, EmptyState, ErrorNotice } from "@/components/ui";
import { apiPost } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

const nav = [
  { href: "/admin", label: "Overview", icon: "◈", exact: true },
  { href: "/admin/organizations", label: "Organisations", icon: "▦" },
  { href: "/admin/users", label: "Users", icon: "◎" },
  { href: "/admin/jobs", label: "Jobs", icon: "⌁" },
  { href: "/admin/audit", label: "Audit log", icon: "▤" },
  { href: "/admin/plans", label: "Plans", icon: "◇" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { me, loading, error } = useMe();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  if (loading || (!me && !error)) return <FullPageLoading label="Loading admin console…" />;
  if (!me && error?.status === 401) return <FullPageLoading label="Redirecting to sign in…" />;
  if (!me) return <div className="center-shell"><ErrorNotice error={error} title="We couldn't load your account" /></div>;
  if (me.user.platformRole !== "SUPER_ADMIN") {
    return (
      <div className="center-shell">
        <EmptyState icon="⚑" title="Not authorised" action={<ButtonLink href="/app">Back to your workspace</ButtonLink>}>
          The admin console is only available to DataPilot platform administrators.
        </EmptyState>
      </div>
    );
  }

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  async function logout(): Promise<void> {
    setSigningOut(true);
    try {
      await apiPost("/auth/logout");
    } catch {
      /* already signed out */
    }
    window.location.assign("/login");
  }

  return (
    <AdminActionProvider>
      <div className="app-frame admin-frame">
        <aside className="sidebar" aria-label="Admin navigation">
          <div className="sidebar-brand"><Brand href="/admin" /><Badge tone="deep">admin</Badge></div>
          <nav className="sidebar-nav">
            <span className="sidebar-label">PLATFORM</span>
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className={`side-link ${isActive(item.href, item.exact) ? "active" : ""}`} aria-current={isActive(item.href, item.exact) ? "page" : undefined}>
                <span aria-hidden="true">{item.icon}</span>{item.label}
              </Link>
            ))}
            <Link href="/app" className="side-link"><span aria-hidden="true">←</span>Workspace</Link>
          </nav>
          <div className="sidebar-foot">
            <span className="eyebrow">SIGNED IN AS</span>
            <b>{me.user.email}</b>
            <button type="button" className="text-button" onClick={() => void logout()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
          </div>
        </aside>
        <div className="app-main">
          <header className="app-topbar">
            <div className="mobile-brand"><Brand href="/admin" /></div>
            <span className="eyebrow">SUPER-ADMIN CONSOLE · EVERY CHANGE IS AUDITED</span>
            <ThemeToggle />
          </header>
          <div className="app-content">{children}</div>
        </div>
      </div>
    </AdminActionProvider>
  );
}
