import Link from "next/link";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";

export type NoticeTone = "info" | "good" | "warn" | "bad";

export function Notice({ tone = "info", title, children, action }: { tone?: NoticeTone; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <div className="notice-text">
        {title && <strong>{title}</strong>}
        {children && <span>{children}</span>}
      </div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

/** Renders an error with helpful next steps for well-known API codes. */
export function ErrorNotice({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const code = error instanceof ApiError ? error.code : null;

  if (code === "SUBSCRIPTION_REQUIRED") {
    return (
      <Notice tone="warn" title="Subscription required" action={<Link className="button button-dark button-small" href="/app/billing">View billing</Link>}>
        {message} Your existing data stays available to view and download.
      </Notice>
    );
  }
  if (code === "PLAN_LIMIT") {
    return (
      <Notice tone="warn" title="Plan limit reached" action={<Link className="button button-dark button-small" href="/app/billing">Compare plans</Link>}>
        {message}
      </Notice>
    );
  }
  if (code === "ORG_SUSPENDED") {
    return <Notice tone="bad" title="Organisation suspended">{message} Please contact DataPilot support.</Notice>;
  }
  if (code === "FORBIDDEN_ROLE") {
    return <Notice tone="warn" title="Not allowed for your role">{message}</Notice>;
  }
  return <Notice tone="bad" title={title}>{message}</Notice>;
}
