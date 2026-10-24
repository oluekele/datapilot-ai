"use client";

import { useState } from "react";
import { useAdminAction } from "@/components/admin/admin-actions";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { Badge, Button, ErrorNotice, Field } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import { apiPatch } from "@/lib/api";
import { formatInterval, formatMoney } from "@/lib/format";
import type { AdminPlan, Limits } from "@/lib/types";

export default function AdminPlansPage() {
  const plans = useResource<AdminPlan[]>("/admin/plans");
  return (
    <>
      <PageHeader eyebrow="ADMIN / PLANS" title="Plans" emphasis="& limits.">
        Changes apply to new checkouts and to every organisation&apos;s limits on that plan.
      </PageHeader>
      {plans.loading && !plans.data && <LoadingBlock />}
      <ErrorNotice error={plans.error} />
      <div className="plan-editor-grid">
        {plans.data?.map((plan) => <PlanEditor key={`${plan.code}-${plan.priceMinor}-${plan.active}-${JSON.stringify(plan.limits)}-${plan.providerPlanCode}`} plan={plan} onSaved={() => plans.reload()} />)}
      </div>
    </>
  );
}

const limitKeys: Array<keyof Limits> = ["maxDatasets", "maxJobsPerMonth", "maxFileMb", "maxMembers"];

function parseLimits(text: string): { limits: Limits | null; error: string | null } {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { limits: null, error: "Limits must be a JSON object." };
    const record = value as Record<string, unknown>;
    for (const key of limitKeys) {
      const n = record[key];
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return { limits: null, error: `${key} must be a non-negative integer.` };
    }
    return { limits: record as unknown as Limits, error: null };
  } catch {
    return { limits: null, error: "Invalid JSON." };
  }
}

function PlanEditor({ plan, onSaved }: { plan: AdminPlan; onSaved: () => Promise<void> }) {
  const run = useAdminAction();
  const [price, setPrice] = useState(String(plan.priceMinor));
  const [providerPlanCode, setProviderPlanCode] = useState(plan.providerPlanCode ?? "");
  const [active, setActive] = useState(plan.active);
  const [limitsText, setLimitsText] = useState(JSON.stringify(plan.limits, null, 2));

  const priceMinor = Number(price);
  const priceValid = price.trim() !== "" && Number.isInteger(priceMinor) && priceMinor >= 0;
  const { limits, error: limitsError } = parseLimits(limitsText);

  const changes: Record<string, unknown> = {};
  if (priceValid && priceMinor !== plan.priceMinor) changes.priceMinor = priceMinor;
  if (providerPlanCode.trim() !== (plan.providerPlanCode ?? "")) changes.providerPlanCode = providerPlanCode.trim();
  if (active !== plan.active) changes.active = active;
  if (limits && JSON.stringify(limits) !== JSON.stringify(plan.limits)) changes.limits = limits;
  const dirty = Object.keys(changes).length > 0;

  function save(): void {
    void run({
      title: `Update plan ${plan.name}`,
      description: <pre className="json-preview">{JSON.stringify(changes, null, 2)}</pre>,
      confirmLabel: "Save plan",
      perform: (reason) => apiPatch(`/admin/plans/${encodeURIComponent(plan.code)}`, { ...changes, reason }),
      onDone: onSaved,
    });
  }

  return (
    <section className="panel plan-editor">
      <div className="panel-head">
        <div>
          <div className="eyebrow">{plan.code.toUpperCase()} · {plan.currency} / {formatInterval(plan.interval)}</div>
          <h2>{plan.name}</h2>
        </div>
        <Badge tone={plan.active ? "good" : "neutral"}>{plan.active ? "active" : "inactive"}</Badge>
      </div>
      <div className="form-stack">
        <Field label="Price (minor units)" hint={priceValid ? `= ${formatMoney(priceMinor, plan.currency)}` : "Whole number, e.g. 1500000 for ₦15,000"} error={!priceValid ? "Enter a non-negative whole number." : null}>
          <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Paystack plan code" hint="Leave empty if this plan isn't sold online.">
          <input value={providerPlanCode} onChange={(e) => setProviderPlanCode(e.target.value)} placeholder="PLN_…" />
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Active (offered to customers)</span>
        </label>
        <Field label="Limits (JSON)" error={limitsError}>
          <textarea className="mono-input" rows={6} value={limitsText} onChange={(e) => setLimitsText(e.target.value)} spellCheck={false} />
        </Field>
        <Button onClick={save} disabled={!dirty || !priceValid || !!limitsError}>Save changes</Button>
      </div>
    </section>
  );
}
