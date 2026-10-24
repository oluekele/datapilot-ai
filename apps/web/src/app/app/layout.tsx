import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { MeProvider } from "@/components/me-provider";

export const metadata: Metadata = { title: { default: "Workspace", template: "%s · DataPilot" }, robots: { index: false } };

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <MeProvider>
      <AppShell>{children}</AppShell>
    </MeProvider>
  );
}
