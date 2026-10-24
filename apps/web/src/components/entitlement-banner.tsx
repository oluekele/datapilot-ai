import Link from "next/link";
import { Notice } from "@/components/ui";
import { daysUntil, formatDate } from "@/lib/format";
import type { Me } from "@/lib/types";

const billingLink = <Link className="button button-dark button-small" href="/app/billing">Go to billing</Link>;

/** Workspace-wide notice about what the active organisation may do right now. */
export function EntitlementBanner({ me }: { me: Me }) {
  const org = me.activeOrganization;
  const entitlement = me.entitlement;

  if (!org) {
    return <Notice tone="warn" title="No active workspace">You are not a member of any organisation yet. Accept an invitation or contact support.</Notice>;
  }
  if (org.status === "SUSPENDED" || entitlement?.reason === "SUSPENDED") {
    return (
      <Notice tone="bad" title="This organisation is suspended">
        Uploading and processing are paused. Your existing data can still be viewed and downloaded. Please contact DataPilot support.
      </Notice>
    );
  }
  if (!entitlement || !entitlement.active) {
    const trialEnded = !!entitlement?.trial && !entitlement.trial.active;
    return (
      <Notice
        tone="warn"
        title={trialEnded ? "Your free trial has ended" : "A subscription is required to upload and process data"}
        action={<Link className="button button-pop button-small" href="/app/billing">Choose a plan</Link>}
      >
        {trialEnded
          ? `Your trial ended on ${formatDate(entitlement!.trial!.expiresAt)}. Subscribe to keep uploading and processing — everything already here stays viewable and downloadable.`
          : "Free trials are one per person and per business, and this workspace has none available. Subscribe to start uploading and processing; existing data stays viewable and downloadable."}
      </Notice>
    );
  }
  if (entitlement.reason === "GRACE") {
    return (
      <Notice tone="warn" title="There is a problem with your payment" action={billingLink}>
        Access continues until {formatDate(entitlement.graceUntil)}. Update your payment to avoid interruption.
      </Notice>
    );
  }
  if (entitlement.reason === "TRIAL" && entitlement.trial?.active) {
    const days = daysUntil(entitlement.trial.expiresAt) ?? 0;
    return (
      <Notice tone="info" title={`Free trial — ${days} ${days === 1 ? "day" : "days"} left`} action={billingLink}>
        Your trial ends on {formatDate(entitlement.trial.expiresAt)}. Subscribe any time to keep processing without a break.
      </Notice>
    );
  }
  return null;
}
