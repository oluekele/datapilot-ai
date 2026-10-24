import { formatDateTime } from "@/lib/format";
import type { AuditEvent } from "@/lib/types";

function hasMetadata(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function AuditTable({ events, showOrg = true }: { events: AuditEvent[]; showOrg?: boolean }) {
  if (events.length === 0) return <p className="muted small">No audit events.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Action</th>
            <th scope="col">Actor</th>
            {showOrg && <th scope="col">Organisation</th>}
            <th scope="col">Subject</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="nowrap">{formatDateTime(event.createdAt)}</td>
              <td><code>{event.action}</code></td>
              <td>{event.actor?.email ?? <span className="muted">system</span>}</td>
              {showOrg && <td>{event.organization?.name ?? "—"}</td>}
              <td className="mono-small">{event.subjectType ? `${event.subjectType}${event.subjectId ? ` · ${event.subjectId.slice(0, 8)}` : ""}` : "—"}</td>
              <td>
                {hasMetadata(event.metadata) ? (
                  <details className="json-details">
                    <summary>View</summary>
                    <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
                    {event.ipAddress && <small className="muted">IP {event.ipAddress}</small>}
                  </details>
                ) : (
                  <span className="muted small">{event.ipAddress ? `IP ${event.ipAddress}` : "—"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
