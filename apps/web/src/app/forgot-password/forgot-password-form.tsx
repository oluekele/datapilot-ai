"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard, DevLink } from "@/components/auth-card";
import { Button, ErrorNotice, Field, Notice } from "@/components/ui";
import { apiPost } from "@/lib/api";
import type { ForgotPasswordResponse } from "@/lib/types";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ForgotPasswordResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      setResult(await apiPost<ForgotPasswordResponse>("/auth/forgot-password", { email: email.trim() }));
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthCard eyebrow="ACCOUNT RECOVERY" title="Forgot your" emphasis="password?" intro="Enter the email you signed up with. If an account exists, we'll send a reset link."
      footer={<>Remembered it? <Link href="/login">Sign in</Link></>}>
      {result ? (
        <div className="form-stack">
          <Notice tone="good" title="Check your email">{result.message}</Notice>
          {result.devResetUrl && <DevLink href={result.devResetUrl} label="Reset your password here" />}
        </div>
      ) : (
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
          </Field>
          <ErrorNotice error={error} />
          <Button type="submit" loading={sending}>Send reset link</Button>
        </form>
      )}
    </AuthCard>
  );
}
