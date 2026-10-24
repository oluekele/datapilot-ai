"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button, ErrorNotice, Field, Notice } from "@/components/ui";
import { apiPost } from "@/lib/api";
import type { MessageResponse } from "@/lib/types";

const MIN_PASSWORD = 10;

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (!token) {
    return (
      <AuthCard eyebrow="ACCOUNT RECOVERY" title="This link is" emphasis="incomplete." intro="The reset link is missing its token. Request a new one to continue.">
        <Link className="button button-dark" href="/forgot-password">Request a new link</Link>
      </AuthCard>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (mismatch || password.length < MIN_PASSWORD) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<MessageResponse>("/auth/reset-password", { token, password });
      setDone(result.message);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <AuthCard eyebrow="PASSWORD UPDATED" title="All" emphasis="done." intro={done}>
        <Notice tone="info">For your security, every existing session has been signed out.</Notice>
        <Link className="button button-dark" href="/login">Sign in <span aria-hidden="true">→</span></Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow="ACCOUNT RECOVERY" title="Choose a new" emphasis="password.">
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`} error={tooShort ? `${MIN_PASSWORD - password.length} more characters needed.` : null}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD} autoComplete="new-password" autoFocus />
        </Field>
        <Field label="Confirm password" error={mismatch ? "Passwords don't match." : null}>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <ErrorNotice error={error} />
        <Button type="submit" loading={saving} disabled={mismatch || password.length < MIN_PASSWORD}>Update password</Button>
      </form>
    </AuthCard>
  );
}
