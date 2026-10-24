import { Badge, type BadgeTone } from "@/components/ui";
import { jobTypeLabel } from "@/lib/labels";
import type { Entitlement, JobStatus, JobType, Risk, Severity, VersionKind } from "@/lib/types";

const jobTones: Record<JobStatus, BadgeTone> = {
  QUEUED: "info",
  RUNNING: "info",
  SUCCEEDED: "good",
  FAILED: "bad",
  CANCELED: "neutral",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge tone={jobTones[status]}>
      {(status === "RUNNING" || status === "QUEUED") && <i className="pulse-dot" aria-hidden="true" />}
      {status.toLowerCase()}
    </Badge>
  );
}

const jobTypeTones: Record<JobType, BadgeTone> = {
  PROFILE: "deep",
  REPAIR: "good",
  EXPLORE: "info",
  ANALYZE: "info",
  VISUALIZE: "warn",
  TRAIN: "neutral",
};

export function JobTypeBadge({ type }: { type: JobType }) {
  return <Badge tone={jobTypeTones[type] ?? "neutral"}>{jobTypeLabel(type).toLowerCase()}</Badge>;
}

const severityTones: Record<Severity, BadgeTone> = { info: "info", warning: "warn", high: "bad" };
export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={severityTones[severity] ?? "neutral"}>{severity}</Badge>;
}

const riskTones: Record<Risk, BadgeTone> = { low: "good", medium: "warn", high: "bad" };
export function RiskBadge({ risk }: { risk: Risk }) {
  return <Badge tone={riskTones[risk] ?? "neutral"}>{risk} risk</Badge>;
}

export function VersionKindBadge({ kind }: { kind: VersionKind }) {
  return <Badge tone={kind === "RAW" ? "deep" : "good"}>{kind.toLowerCase()}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const value = status.toUpperCase();
  const tone: BadgeTone =
    value === "ACTIVE" || value === "SUCCESS" || value === "SUCCEEDED" || value === "PAID"
      ? "good"
      : value === "SUSPENDED" || value === "FAILED" || value === "ABANDONED"
        ? "bad"
        : value.includes("PENDING") || value === "PAST_DUE" || value === "INCOMPLETE"
          ? "warn"
          : "neutral";
  return <Badge tone={tone}>{status.toLowerCase().replace(/_/g, " ")}</Badge>;
}

export function EntitlementBadge({ entitlement }: { entitlement: Entitlement | null }) {
  if (!entitlement) return <Badge>none</Badge>;
  const labels: Record<Entitlement["reason"], string> = {
    SUBSCRIPTION: "subscribed",
    TRIAL: "trial",
    GRACE: "grace period",
    NONE: "no access",
    SUSPENDED: "suspended",
  };
  const tone: BadgeTone = !entitlement.active ? (entitlement.reason === "SUSPENDED" ? "bad" : "neutral") : entitlement.reason === "GRACE" ? "warn" : entitlement.reason === "TRIAL" ? "info" : "good";
  return <Badge tone={tone}>{labels[entitlement.reason]}</Badge>;
}
