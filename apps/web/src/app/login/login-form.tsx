"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button, ButtonLink, Field, Notice } from "@/components/ui";
import { ApiError, apiPost, safeNextPath } from "@/lib/api";
import type { Me } from "@/lib/types";

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [adminMe, setAdminMe] = useState<Me | null>(null);
  const destination = safeNextPath(next);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const me = await apiPost<Me>("/auth/login", { email: email.trim(), password });
      if (me.user.platformRole === "SUPER_ADMIN" && !next) {
        setAdminMe(me);
        return;
      }
      router.replace(destination);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, null, "Unable to sign in."));
    } finally {
      setSubmitting(false);
    }
  }

  if (adminMe) {
    return (
      <AuthCard eyebrow="SIGNED IN" title={`Welcome back,`} emphasis={`${adminMe.user.displayName.split(" ")[0]}.`} intro="You have platform administrator access. Where would you like to go?">
        <div className="button-row">
          <ButtonLink href={destination}>Open workspace <span aria-hidden="true">→</span></ButtonLink>
          <ButtonLink href="/admin" variant="light">Admin console</ButtonLink>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="WELCOME BACK"
      title="Sign in to"
      emphasis="DataPilot."
      footer={<>New here? <Link href="/register">Create an account</Link></>}
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
        </Field>
        <Field label="Password" hint={<Link href="/forgot-password">Forgot your password?</Link>}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        {error && <LoginError error={error} />}
        <Button type="submit" loading={submitting}>Sign in <span aria-hidden="true">→</span></Button>
      </form>
    </AuthCard>
  );
}

function LoginError({ error }: { error: ApiError }) {
  switch (error.code) {
    case "ACCOUNT_LOCKED":
      return <Notice tone="bad" title="Too many sign-in attempts">{error.message} For your security the account is temporarily locked — please wait a while and try again, or reset your password.</Notice>;
    case "ACCOUNT_SUSPENDED":
      return <Notice tone="bad" title="Account suspended">{error.message} Please contact DataPilot support if you think this is a mistake.</Notice>;
    default:
      return <Notice tone="bad">{error.message}</Notice>;
  }
}
