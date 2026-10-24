import { HealthRing, healthLabel } from "@/components/health-ring";
import { SeverityBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui";
import { formatBytes, formatNumber } from "@/lib/format";
import type { ProfileResult, Severity } from "@/lib/types";

const severityOrder: Record<Severity, number> = { high: 0, warning: 1, info: 2 };

export function ProfileView({ result }: { result: ProfileResult }) {
  const { overview } = result;
  const findings = [...(result.findings ?? [])].sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));
  const counts = findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }), {});

  return (
    <div className="profile">
      <div className="profile-summary">
        <HealthRing score={result.healthScore} />
        <div>
          <strong>{healthLabel(result.healthScore)}</strong>
          <p className="muted small">
            {findings.length === 0 ? "No issues found." : `${findings.length} findings`}
            {counts.high ? ` · ${counts.high} high` : ""}
            {counts.warning ? ` · ${counts.warning} warnings` : ""}
          </p>
          <p className="muted small">The health score is a heuristic summary — read the findings for context.</p>
        </div>
      </div>

      <dl className="overview-grid">
        <div><dt>Rows</dt><dd>{formatNumber(overview.rows)}</dd></div>
        <div><dt>Columns</dt><dd>{formatNumber(overview.columns)}</dd></div>
        <div><dt>Missing cells</dt><dd>{formatNumber(overview.missing_cells)} <small>({formatNumber(overview.missing_percentage, 1)}%)</small></dd></div>
        <div><dt>Duplicate rows</dt><dd>{formatNumber(overview.duplicate_rows)}</dd></div>
        <div><dt>In memory</dt><dd>{formatBytes(overview.memory_usage_bytes)}</dd></div>
      </dl>

      <h3 className="subhead">Findings</h3>
      {findings.length === 0 ? (
        <p className="muted small">Nothing to flag.</p>
      ) : (
        <ul className="findings">
          {findings.map((finding, index) => (
            <li key={`${finding.type}-${finding.column ?? "all"}-${index}`} className={`finding finding-${finding.severity}`}>
              <div className="finding-head">
                <SeverityBadge severity={finding.severity} />
                <b>{finding.type.replace(/_/g, " ")}</b>
                {finding.column && <code>{finding.column}</code>}
              </div>
              <p>{finding.evidence}</p>
              {finding.recommendation && <p className="muted small">→ {finding.recommendation}</p>}
            </li>
          ))}
        </ul>
      )}

      <h3 className="subhead">Columns</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Type</th>
              <th scope="col" className="num">Missing</th>
              <th scope="col" className="num">Unique</th>
              <th scope="col" className="num">Mean</th>
              <th scope="col" className="num">Median</th>
              <th scope="col" className="num">Min</th>
              <th scope="col" className="num">Max</th>
              <th scope="col" className="num">Outliers</th>
            </tr>
          </thead>
          <tbody>
            {(result.columns ?? []).map((col) => (
              <tr key={col.column}>
                <th scope="row"><code>{col.column}</code>{col.is_constant && <> <Badge tone="warn">constant</Badge></>}</th>
                <td className="mono-small">{col.data_type}</td>
                <td className="num">{formatNumber(col.missing)} <small className="muted">{formatNumber(col.missing_percentage, 1)}%</small></td>
                <td className="num">{formatNumber(col.unique_values)}</td>
                <td className="num">{formatNumber(col.mean, 2)}</td>
                <td className="num">{formatNumber(col.median, 2)}</td>
                <td className="num">{formatNumber(col.min, 2)}</td>
                <td className="num">{formatNumber(col.max, 2)}</td>
                <td className="num">{col.potential_outliers_iqr === undefined ? "—" : formatNumber(col.potential_outliers_iqr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
