"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { DevLink } from "@/components/auth-card";
import { useMe } from "@/components/me-provider";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { Badge, Button, ErrorNotice, Field, Modal, Notice } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import { apiDelete, apiPatch, apiPost } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { OrgMember, Organization, Role } from "@/lib/types";

export default function TeamPage() {
  const { me, refresh } = useMe();
  const org = useResource<Organization>("/organization");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [removing, setRemoving] = useState<OrgMember | null>(null);

  if (!me) return null;
  const myRole: Role | undefined = me.activeOrganization?.role;
  const isOwner = myRole === "OWNER";
  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  async function run(key: string, action: () => Promise<unknown>): Promise<void> {
    setPending(key);
    setError(null);
    try {
      await action();
      await org.reload();
      void refresh();
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  }

  const data = org.data;

  return (
    <>
      <PageHeader eyebrow="WORKSPACE / TEAM" title="People with" emphasis="access.">
        Everyone listed here can see this organisation&apos;s datasets and history.
      </PageHeader>
      {org.loading && !data && <LoadingBlock label="Loading team…" />}
      <ErrorNotice error={org.error} title="Couldn't load your organisation" />
      <ErrorNotice error={error} />

      {data && (
        <>
          {canManage && <RenameOrg name={data.name} onSaved={() => void run("rename", async () => undefined)} />}

          <section className="section-block">
            <div className="section-head"><h2>Members</h2><span className="muted">{data.members.length}{me.entitlement ? ` of ${me.entitlement.limits.maxMembers}` : ""}</span></div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {data.members.map((member) => {
                    const isSelf = member.userId === me.user.id;
                    return (
                      <tr key={member.userId}>
                        <td><b>{member.displayName}</b>{isSelf && <span className="muted small"> (you)</span>}</td>
                        <td>{member.email}</td>
                        <td>
                          {isOwner && member.role !== "OWNER" ? (
                            <select
                              aria-label={`Role for ${member.displayName}`}
                              value={member.role}
                              disabled={pending !== null}
                              onChange={(e) => void run(`role-${member.userId}`, () => apiPatch(`/organization/members/${encodeURIComponent(member.userId)}`, { role: e.target.value }))}
                            >
                              <option value="ADMIN">Admin</option>
                              <option value="MEMBER">Member</option>
                            </select>
                          ) : (
                            <Badge tone={member.role === "OWNER" ? "deep" : "neutral"}>{member.role.toLowerCase()}</Badge>
                          )}
                        </td>
                        <td className="nowrap">{formatDate(member.joinedAt)}</td>
                        <td className="actions-cell">
                          {canManage && member.role !== "OWNER" && !isSelf && (
                            <Button variant="ghost" size="small" onClick={() => setRemoving(member)} disabled={pending !== null}>Remove</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {data.kind === "TEAM" ? (
            <>
              {data.invitations.length > 0 && (
                <section className="section-block">
                  <div className="section-head"><h2>Pending invitations</h2></div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Sent</th><th scope="col">Expires</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                      <tbody>
                        {data.invitations.map((invite) => (
                          <tr key={invite.id}>
                            <td>{invite.email}</td>
                            <td><Badge>{invite.role.toLowerCase()}</Badge></td>
                            <td className="nowrap">{formatDate(invite.createdAt)}</td>
                            <td className="nowrap">{formatDate(invite.expiresAt)}</td>
                            <td className="actions-cell">
                              {canManage && (
                                <Button variant="ghost" size="small" loading={pending === `revoke-${invite.id}`} disabled={pending !== null}
                                  onClick={() => void run(`revoke-${invite.id}`, () => apiDelete(`/organization/invitations/${encodeURIComponent(invite.id)}`))}>
                                  Revoke
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {canManage ? (
                <InviteForm onInvited={() => void org.reload()} />
              ) : (
                <Notice tone="info">Ask an owner or admin to invite new members.</Notice>
              )}
            </>
          ) : (
            <Notice tone="info" title="This is a personal workspace">
              Individual accounts have a single member. To collaborate, create an organisation account from the{" "}
              <Link href="/register">sign-up page</Link> — you can then invite colleagues and share datasets.
            </Notice>
          )}
        </>
      )}

      <Modal
        open={removing !== null}
        title="Remove member?"
        onClose={() => setRemoving(null)}
        locked={pending !== null}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={pending === "remove"}
              onClick={() => {
                const member = removing;
                if (!member) return;
                void run("remove", () => apiDelete(`/organization/members/${encodeURIComponent(member.userId)}`)).then(() => setRemoving(null));
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p><b>{removing?.displayName}</b> ({removing?.email}) will immediately lose access to this organisation&apos;s data.</p>
      </Modal>
    </>
  );
}

function RenameOrg({ name, onSaved }: { name: string; onSaved: () => void }) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPatch("/organization", { name: value.trim() });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel inline-form" onSubmit={(event) => void submit(event)}>
      <Field label="Organisation name">
        <input value={value} onChange={(e) => setValue(e.target.value)} required minLength={2} maxLength={120} />
      </Field>
      <Button type="submit" variant="light" loading={saving} disabled={value.trim() === name || value.trim().length < 2}>Save</Button>
      <ErrorNotice error={error} />
    </form>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<{ email: string; devInviteUrl?: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSending(true);
    setError(null);
    setSent(null);
    try {
      const result = await apiPost<{ id: string; devInviteUrl?: string }>("/organization/invitations", { email: email.trim(), role });
      setSent({ email: email.trim(), devInviteUrl: result.devInviteUrl });
      setEmail("");
      onInvited();
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="section-block">
      <div className="section-head"><h2>Invite someone</h2></div>
      <form className="panel inline-form" onSubmit={(event) => void submit(event)}>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Role" hint={role === "ADMIN" ? "Admins can invite and remove members and manage billing." : "Members can upload, profile and repair data."}>
          <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}>
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
        </Field>
        <Button type="submit" loading={sending}>Send invitation</Button>
      </form>
      <ErrorNotice error={error} />
      {sent && <Notice tone="good">Invitation sent to {sent.email}. It must be accepted by that email address.</Notice>}
      {sent?.devInviteUrl && <DevLink href={sent.devInviteUrl} label="Invitation link" />}
    </section>
  );
}
