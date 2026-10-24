import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export function AuthCard({ eyebrow, title, emphasis, intro, children, footer }: {
  eyebrow: string;
  title: string;
  emphasis?: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <header className="auth-top">
        <Brand />
        <div className="top-actions">
          <ThemeToggle />
          <Link className="text-button" href="/">← Back to home</Link>
        </div>
      </header>
      <section className="auth-card">
        <div className="eyebrow"><span className="eyebrow-dot" /> {eyebrow}</div>
        <h1>{title} {emphasis && <em>{emphasis}</em>}</h1>
        {intro && <p className="auth-intro">{intro}</p>}
        {children}
      </section>
      {footer && <div className="auth-footer">{footer}</div>}
    </main>
  );
}

export function DevLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="dev-link">
      <span className="badge badge-warn">DEV ONLY</span>
      <span>Email is not configured in this environment. {label}:</span>
      <a href={href}>{href}</a>
    </div>
  );
}
