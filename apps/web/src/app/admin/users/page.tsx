"use client";

import { useEffect, useState } from "react";
import { useAdminAction } from "@/components/admin/admin-actions";
import { useMe } from "@/components/me-provider";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badges";
import { Badge, Button, EmptyState, ErrorNotice } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import { apiPost } from "@/lib/api";
import { formatDate, formatRelative } from "@/lib/format";
import type { AdminUser } from "@/lib/types";

export default function AdminUsersPage() {
  const { me } = useMe();
  const run = useAdminAction();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const users = useResource<AdminUser[]>(`/admin/users${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`);

  function toggle(user: AdminUser): void {
    const suspend = user.status.toUpperCase() !== "SUSPENDED";
    void run({
      title: suspend ? `Suspend ${user.email}` : `Reactivate ${user.email}`,
      description: suspend ? <p>The user is signed out everywhere and cannot sign in until reactivated.</p> : undefined,
      danger: suspend,
      confirmLabel: suspend ? "Suspend user" : "Reactivate user",
      perform: (reason) => apiPost(`/admin/users/${encodeURIComponent(user.id)}/${suspend ? "suspend" : "reactivate"}`, { reason }),
      onDone: () => users.reload(),
    });
  }

  return (
    <>
      <PageHeader eyebrow="ADMIN / USERS" title="Users" emphasis="& sign-ins." />
      <div className="filter-bar">
        <label className="field inline-field grow">
          <span>Search</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Email or name" />
        </label>
      </div>
      {users.loading && !users.data && <LoadingBlock />}
      <ErrorNotice error={users.error} />
      {users.data && users.data.length === 0 && <EmptyState title="No users match" icon="◎" />}
      {users.data && users.data.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Status</th>
                <th scope="col">Verified</th>
                <th scope="col">Organisations</th>
                <th scope="col">Trial used</th>
                <th scope="col">Last sign-in</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <tr key={user.id}>
                  <td>
                    <b>{user.displayName}</b> {user.platformRole === "SUPER_ADMIN" && <Badge tone="deep">super admin</Badge>}
                    <div className="muted small">{user.email} · joined {formatDate(user.createdAt)}</div>
                  </td>
                  <td><StatusBadge status={user.status} /></td>
                  <td>{user.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : <Badge tone="warn">no</Badge>}</td>
                  <td>{user.organizations.length === 0 ? "—" : user.organizations.map((o) => <div key={o.id} className="small">{o.name} <span className="muted">· {o.role.toLowerCase()}</span></div>)}</td>
                  <td>{user.trialUsed ? <Badge>yes</Badge> : <span className="muted small">no</span>}</td>
                  <td className="nowrap">{user.lastLoginAt ? formatRelative(user.lastLoginAt) : "never"}</td>
                  <td className="actions-cell">
                    {user.id !== me?.user.id && (
                      <Button size="small" variant={user.status.toUpperCase() === "SUSPENDED" ? "light" : "ghost"} onClick={() => toggle(user)}>
                        {user.status.toUpperCase() === "SUSPENDED" ? "Reactivate" : "Suspend"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
