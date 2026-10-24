import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { MeProvider } from "@/components/me-provider";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · DataPilot Admin" }, robots: { index: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <MeProvider>
      <AdminShell>{children}</AdminShell>
    </MeProvider>
  );
}
