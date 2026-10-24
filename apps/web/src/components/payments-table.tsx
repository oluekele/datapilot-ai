import { StatusBadge } from "@/components/status-badges";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Payment } from "@/lib/types";

export function PaymentsTable({ payments }: { payments: Payment[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th scope="col">Date</th><th scope="col">Plan</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Reference</th></tr></thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td className="nowrap">{formatDateTime(p.paidAt ?? p.createdAt)}</td>
              <td>{p.planName ?? "—"}</td>
              <td className="num">{formatMoney(p.amountMinor, p.currency)}</td>
              <td><StatusBadge status={p.status} /></td>
              <td className="mono-small">{p.reference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
