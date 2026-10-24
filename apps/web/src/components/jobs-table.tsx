import Link from "next/link";
import { JobStatusBadge, JobTypeBadge } from "@/components/status-badges";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { Job } from "@/lib/types";

export function JobsTable({ jobs, showOrg = false, linkDatasets = true }: { jobs: Array<Job & { organizationName?: string }>; showOrg?: boolean; linkDatasets?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Type</th>
            {showOrg && <th scope="col">Organisation</th>}
            <th scope="col">Dataset</th>
            <th scope="col">Status</th>
            <th scope="col">By</th>
            <th scope="col">Created</th>
            <th scope="col" className="num">Duration</th>
            <th scope="col">Error</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td><JobTypeBadge type={job.type} /></td>
              {showOrg && <td>{job.organizationName ?? "—"}</td>}
              <td>
                {linkDatasets ? (
                  <Link className="table-link" href={`/app/datasets/${job.datasetId}`}>{job.datasetName ?? "Dataset"}</Link>
                ) : (
                  job.datasetName ?? "—"
                )}
              </td>
              <td><JobStatusBadge status={job.status} /></td>
              <td>{job.createdBy?.displayName ?? "—"}</td>
              <td className="nowrap">{formatDateTime(job.createdAt)}</td>
              <td className="num">{formatDuration(job.startedAt, job.finishedAt)}</td>
              <td className="error-cell">{job.errorMessage ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
