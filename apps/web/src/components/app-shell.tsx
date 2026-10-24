"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import { EntitlementBanner } from "@/components/entitlement-banner";
import { useMe } from "@/components/me-provider";
import { TourDialog } from "@/components/tour-dialog";
import { ErrorNotice } from "@/components/ui";
import { workspaceSteps } from "@/components/workspace-onboarding";
import { apiPost } from "@/lib/api";
import type { Me } from "@/lib/types";
import { ThemeToggle } from "@/components/theme-toggle";

const nav = [
  { href: "/app", label: "Datasets", icon: "◫", exact: true },
  { href: "/app/library", label: "Library", icon: "▣" },
  { href: "/app/history", label: "History", icon: "▤" },
  { href: "/app/team", label: "Team", icon: "◎" },
  { href: "/app/billing", label: "Billing", icon: "◇" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, error, refresh } = useMe();

  if (loading || (!me && !error)) return <FullPageLoading />;
  if (!me && error?.status === 401) return <FullPageLoading label="Redirecting to sign in…" />;
  if (!me) {
    return (
      <div className="center-shell">
        <ErrorNotice error={error} title="We couldn't load your workspace" />
        <button className="button button-light" type="button" onClick={() => void refresh()}>Try again</button>
      </div>
    );
  }
  return <Shell me={me}>{children}</Shell>;
}

export function FullPageLoading({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="center-shell" role="status">
      <span className="brand-mark" aria-hidden="true">D</span>
      <span className="muted">{label}</span>
    </div>
  );
}

function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const { refresh } = useMe();
  const [guideOpen, setGuideOpen] = useState(!me.user.onboardingCompleted);
  const [savingGuide, setSavingGuide] = useState(false);

  async function closeGuide(): Promise<void> {
    if (!me.user.onboardingCompleted) {
      setSavingGuide(true);
      try {
        await apiPost("/auth/onboarding/complete");
        await refresh();
      } catch {
        /* non-fatal: the guide will simply be offered again next visit */
      } finally {
        setSavingGuide(false);
      }
    }
    setGuideOpen(false);
  }

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href || pathname.startsWith("/app/datasets") : pathname.startsWith(href);

  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar-brand"><Brand href="/app" /></div>
        <nav className="sidebar-nav">
          <span className="sidebar-label">WORKSPACE</span>
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className={`side-link ${isActive(item.href, item.exact) ? "active" : ""}`} aria-current={isActive(item.href, item.exact) ? "page" : undefined}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </Link>
          ))}
          <button type="button" className="side-link" onClick={() => setGuideOpen(true)}>
            <span aria-hidden="true">✳</span>Guide
          </button>
          {me.user.platformRole === "SUPER_ADMIN" && (
            <Link href="/admin" className="side-link side-admin"><span aria-hidden="true">⚑</span>Admin console</Link>
          )}
        </nav>
        <div className="sidebar-foot">
          <span className="eyebrow">DATA STAYS PRIVATE TO</span>
          <b>{me.activeOrganization?.name ?? "—"}</b>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="mobile-brand"><Brand href="/app" /></div>
          <OrgSwitcher me={me} />
          <ThemeToggle />
          <UserMenu me={me} />
        </header>
        <div className="app-content">
          <EntitlementBanner me={me} />
          <div key={me.activeOrganization?.id ?? "none"}>{children}</div>
        </div>
      </div>

      <TourDialog
        steps={workspaceSteps}
        open={guideOpen}
        busy={savingGuide}
        label="WORKSPACE GUIDE"
        finishLabel="Start working"
        onDone={() => void closeGuide()}
      />
    </div>
  );
}

function OrgSwitcher({ me }: { me: Me }) {
  const { setMe } = useMe();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (me.organizations.length === 0) return <div className="org-switcher" />;

  async function switchTo(organizationId: string): Promise<void> {
    if (organizationId === me.activeOrganization?.id) return;
    setSwitching(true);
    setError(null);
    try {
      const next = await apiPost<Me>("/auth/switch-organization", { organizationId });
      setMe(next);
      router.push("/app");
    } catch (err) {
      setError(err);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="org-switcher">
      <label className="eyebrow" htmlFor="org-switch">WORKSPACE</label>
      <select
        id="org-switch"
        value={me.activeOrganization?.id ?? ""}
        disabled={switching}
        onChange={(event) => void switchTo(event.target.value)}
      >
        {me.organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name} · {org.kind === "TEAM" ? "team" : "personal"} · {org.role.toLowerCase()}
          </option>
        ))}
      </select>
      {error instanceof Error && <span className="field-error" role="alert">{error.message}</span>}
    </div>
  );
}

function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout(): Promise<void> {
    setSigningOut(true);
    try {
      await apiPost("/auth/logout");
    } catch {
      /* the session may already be gone */
    }
    window.location.assign("/login");
  }

  const initials = me.user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="avatar" aria-hidden="true">{initials || "?"}</span>
        <span className="user-name">{me.user.displayName}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <b>{me.user.displayName}</b>
            <small>{me.user.email}</small>
          </div>
          <Link role="menuitem" href="/app/team" onClick={() => setOpen(false)}>Team</Link>
          <Link role="menuitem" href="/app/billing" onClick={() => setOpen(false)}>Billing</Link>
          {me.user.platformRole === "SUPER_ADMIN" && <Link role="menuitem" href="/admin" onClick={() => setOpen(false)}>Admin console</Link>}
          <button role="menuitem" type="button" onClick={() => void logout()} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
