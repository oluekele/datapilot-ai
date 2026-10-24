import type { Metadata } from "next";
import { AdminOrganizationView } from "./organization-view";

export const metadata: Metadata = { title: "Organisation" };

export default async function AdminOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminOrganizationView orgId={id} />;
}
