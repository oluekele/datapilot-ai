import type { Metadata } from "next";
import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = { title: "Join a workspace" };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <AcceptInvite token={typeof token === "string" ? token : null} />;
}
