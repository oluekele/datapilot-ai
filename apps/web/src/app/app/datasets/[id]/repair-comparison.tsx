import { formatNumber } from "@/lib/format";
import type { RepairResult, RepairSnapshot } from "@/lib/types";

const metrics: Array<{ key: keyof RepairSnapshot; label: string; lowerIsBetter: boolean }> = [
  { key: "rows", label: "Rows", lowerIsBetter: false },
  { key: "columns", label: "Columns", lowerIsBetter: false },
  { key: "missing_cells", label: "Missing cells", lowerIsBetter: true },
  { key: "duplicate_rows", label: "Duplicate rows", lowerIsBetter: true },
];

export function RepairComparison({ result }: { result: RepairResult }) {
  return (
    <div className="comparison">
      <div className="compare-grid">
        {metrics.map(({ key, label, lowerIsBetter }) => {
          const before = result.before?.[key] ?? 0;
          const after = result.after?.[key] ?? 0;
          const delta = after - before;
          const improved = lowerIsBetter ? delta < 0 : false;
          return (
            <div className="compare-tile" key={key}>
              <div className="eyebrow">{label.toUpperCase()}</div>
              <div className="compare-values">
                <span>{formatNumber(before)}</span>
                <span aria-hidden="true">→</span>
                <b>{formatNumber(after)}</b>
              </div>
              <small className={delta === 0 ? "muted" : improved ? "delta-good" : "delta-neutral"}>
                {delta === 0 ? "unchanged" : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`}
              </small>
            </div>
          );
        })}
      </div>
      {result.applied?.length > 0 && (
        <>
          <h3 className="subhead">Applied repairs</h3>
          <ul className="applied-list">
            {result.applied.map((item) => (
              <li key={item.id}>
                <b>{item.title}</b>
                {item.method && <span className="badge badge-neutral">{item.method}</span>}
                <span className="mono-small">{formatNumber(item.changed_count)} changed</span>
                <p className="muted small">{item.detail}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
