import type { Metadata } from "next";
import { BillingView } from "./billing-view";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ reference?: string | string[]; trxref?: string | string[] }> }) {
  const { reference, trxref } = await searchParams;
  const ref = typeof reference === "string" ? reference : typeof trxref === "string" ? trxref : null;
  return <BillingView reference={ref} />;
}
