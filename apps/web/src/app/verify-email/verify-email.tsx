"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthCard, DevLink } from "@/components/auth-card";
import { Button, ErrorNotice, Field, Notice } from "@/components/ui";
import { apiPost } from "@/lib/api";
import type { MessageResponse, RegisterResponse } from "@/lib/types";

export function VerifyEmail({ token }: { token: string | null }) {
  const [state, setState] = useState<"idle" | "verifying" | "verified" | "failed">(token ? "verifying" : "idle");
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    apiPost<MessageResponse>("/auth/verify-email", { token })
      .then((result) => {
        setMessage(result.message);
        setState("verified");
      })
      .catch((err: unknown) => {
        setError(err);
        setState("failed");
      });
  }, [token]);

  if (state === "verified") {
    return (
      <AuthCard eyebrow="EMAIL VERIFIED" title="You're" emphasis="all set." intro={message || "Your email address is confirmed."}>
        <Link className="button button-dark" href="/login">Sign in <span aria-hidden="true">→</span></Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow="VERIFY YOUR EMAIL" title="Confirm your" emphasis="address." intro={state === "verifying" ? "Checking your verification link…" : "Enter your email and we'll send a fresh verification link."}
      footer={<>Already verified? <Link href="/login">Sign in</Link></>}>
      {state === "failed" && <ErrorNotice error={error} title="This link didn't work" />}
      {state !== "verifying" && <ResendVerification />}
    </AuthCard>
  );
}

export function ResendVerification({ initialEmail = "" }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      setResult(await apiPost<RegisterResponse>("/auth/resend-verification", { email: email.trim() }));
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </Field>
      <ErrorNotice error={error} />
      {result && <Notice tone="good">{result.message}</Notice>}
      {result?.devVerificationUrl && <DevLink href={result.devVerificationUrl} label="Verify your email here" />}
      <Button type="submit" variant="light" loading={sending}>Resend verification email</Button>
    </form>
  );
}
