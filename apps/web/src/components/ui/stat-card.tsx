import type { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** When provided, renders a usage meter (used / limit). */
  meter?: { used: number; limit: number };
};

export function StatCard({ label, value, sub, meter }: StatCardProps) {
  const pct = meter && meter.limit > 0 ? Math.min(100, Math.round((meter.used / meter.limit) * 100)) : null;
  return (
    <div className="stat-card">
      <div className="eyebrow">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {pct !== null && (
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${label} ${pct}% used`}>
          <em className={pct >= 90 ? "meter-hot" : ""} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
