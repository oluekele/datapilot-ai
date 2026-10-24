"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { formatInterval, formatMoney, formatNumber } from "@/lib/format";
import type { Plan } from "@/lib/types";

type State = { kind: "loading" } | { kind: "ready"; plans: Plan[] } | { kind: "unavailable" };
type TrialPolicy = { days: number; automatic: boolean };

export function PricingSection() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [trial, setTrial] = useState<TrialPolicy | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiGet<Plan[]>("/billing/plans", controller.signal)
      .then((plans) => setState(Array.isArray(plans) && plans.length > 0 ? { kind: "ready", plans } : { kind: "unavailable" }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ kind: "unavailable" });
      });
    apiGet<TrialPolicy>("/billing/trial", controller.signal)
      .then(setTrial)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <section className="pricing-section" id="pricing">
      <div className="section-intro">
        <div className="eyebrow">START FREE, THEN PICK A PLAN</div>
        <h2>Try it free.<br /><em>Keep your originals.</em></h2>
        <p>
          {trial?.automatic
            ? `Every new account starts with a ${trial.days}-day free trial — no card required. `
            : "Start with a free trial — no card required. "}
          After the trial, uploading and processing need a subscription. Your data always stays viewable and downloadable.
        </p>
      </div>

      {state.kind === "loading" && (
        <div className="plan-grid" aria-busy="true">
          {[0, 1, 2].map((i) => <div className="plan-card plan-skeleton" key={i} />)}
        </div>
      )}

      {state.kind === "unavailable" && (
        <div className="plan-fallback">
          <p>Plan details are temporarily unavailable. Create an account to start your free trial and see current pricing.</p>
          <Link className="button button-dark button-small" href="/register">Get started</Link>
        </div>
      )}

      {state.kind === "ready" && (
        <div className="plan-grid">
          {state.plans.map((plan, index) => (
            <article className={`plan-card ${index === 1 ? "plan-featured" : ""}`} key={plan.code}>
              <div className="eyebrow">{plan.code.toUpperCase()}</div>
              <h3>{plan.name}</h3>
              <div className="plan-price">
                <b>{formatMoney(plan.priceMinor, plan.currency)}</b>
                <span>/ {formatInterval(plan.interval)}</span>
              </div>
              {plan.description && <p>{plan.description}</p>}
              <ul className="plan-limits">
                <li>{formatNumber(plan.limits.maxDatasets)} datasets</li>
                <li>{formatNumber(plan.limits.maxJobsPerMonth)} processing jobs / month</li>
                <li>Files up to {formatNumber(plan.limits.maxFileMb)} MB</li>
                <li>{plan.limits.maxMembers === 1 ? "1 member" : `Up to ${formatNumber(plan.limits.maxMembers)} members`}</li>
              </ul>
              <Link className={`button ${index === 1 ? "button-pop" : "button-light"} button-small`} href="/register">
                Start free trial <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      )}

      <p className="pricing-note"><span aria-hidden="true">✳</span> {trial?.automatic ? `${trial.days}-day free trial on every new account.` : "Free trial on every new account."} One trial per person and per business.</p>
    </section>
  );
}
