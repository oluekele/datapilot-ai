"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard, DevLink } from "@/components/auth-card";
import { Button, ErrorNotice, Field } from "@/components/ui";
import { apiPost } from "@/lib/api";
import type { RegisterResponse } from "@/lib/types";

type AccountType = "INDIVIDUAL" | "TEAM";
const MIN_PASSWORD = 10;

export function RegisterForm() {
  const [accountType, setAccountType] = useState<AccountType>("INDIVIDUAL");
  const [organizationName, setOrganizationName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<RegisterResponse | null>(null);

  const passwordShort = password.length > 0 && password.length < MIN_PASSWORD;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiPost<RegisterResponse>("/auth/register", {
        accountType,
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        ...(accountType === "TEAM" ? { organizationName: organizationName.trim() } : {}),
      });
      setDone(result);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthCard eyebrow="ALMOST THERE" title="Check your" emphasis="inbox." intro={<>We sent a verification link to <b>{email}</b>. Open it to activate your account, then sign in.</>}
        footer={<>Didn&apos;t get it? <Link href="/verify-email">Resend the verification email</Link></>}>
        <p className="muted small">{done.message}</p>
        {done.devVerificationUrl && <DevLink href={done.devVerificationUrl} label="Verify your email here" />}
        <Link className="button button-light" href="/login">Go to sign in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="CREATE YOUR ACCOUNT"
      title="Start with"
      emphasis="cleaner data."
      intro="Set up a private workspace. Your free trial starts as soon as you verify your email — no card required."
      footer={<>Already have an account? <Link href="/login">Sign in</Link></>}
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate={false}>
        <fieldset className="segmented">
          <legend>Account type</legend>
          <label className={accountType === "INDIVIDUAL" ? "selected" : ""}>
            <input type="radio" name="accountType" value="INDIVIDUAL" checked={accountType === "INDIVIDUAL"} onChange={() => setAccountType("INDIVIDUAL")} />
            <b>Individual</b>
            <small>A private workspace just for you</small>
          </label>
          <label className={accountType === "TEAM" ? "selected" : ""}>
            <input type="radio" name="accountType" value="TEAM" checked={accountType === "TEAM"} onChange={() => setAccountType("TEAM")} />
            <b>Organisation</b>
            <small>Share datasets and invite your team</small>
          </label>
        </fieldset>

        {accountType === "TEAM" && (
          <Field label="Organisation name">
            <input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} required minLength={2} maxLength={120} autoComplete="organization" />
          </Field>
        )}
        <Field label="Your name">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Work email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters. A short passphrase works well.`}
          error={passwordShort ? `${MIN_PASSWORD - password.length} more characters needed.` : null}
        >
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD} autoComplete="new-password" />
        </Field>

        <ErrorNotice error={error} />
        <Button type="submit" loading={submitting} disabled={password.length < MIN_PASSWORD}>
          Create account <span aria-hidden="true">→</span>
        </Button>
      </form>
    </AuthCard>
  );
}
