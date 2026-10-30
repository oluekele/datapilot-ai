"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button, ButtonLink, ErrorNotice } from "@/components/ui";
import { ApiError, apiGet, apiPost, loginUrlFor } from "@/lib/api";
import type { Me } from "@/lib/types";

type State = { kind: "checking" } | { kind: "signed-out" } | { kind: "accepting"; me: Me } | { kind: "failed"; me: Me | null; error: unknown };

export function AcceptInvite({ token }: { token: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "checking" });
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    (async () => {
      let me: Me;
      try {
        me = await apiGet<Me>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setState({ kind: "signed-out" });
        else setState({ kind: "failed", me: null, error: err });
        return;
      }
      setState({ kind: "accepting", me });
      try {
        await apiPost<Me>("/invitations/accept", { token });
        router.replace("/app");
      } catch (err) {
        setState({ kind: "failed", me, error: err });
      }
    })();
  }, [token, router]);

  if (!token) {
    return (
      <AuthCard eyebrow="INVITATION" title="This invitation link is" emphasis="incomplete." intro="Ask the person who invited you to send it again.">
        <Link className="button button-light" href="/">Back to home</Link>
      </AuthCard>
    );
  }

  const here = `/invite?token=${encodeURIComponent(token)}`;

  if (state.kind === "signed-out") {
    return (
      <AuthCard eyebrow="YOU'RE INVITED" title="Join your team on" emphasis="DataPilot." intro="Sign in with the email address the invitation was sent to. New to DataPilot? Create an account with that email, then open this link again.">
        <div className="button-row">
          <ButtonLink href={loginUrlFor(here)}>Sign in to accept <span aria-hidden="true">→</span></ButtonLink>
          <ButtonLink href="/register" variant="light">Create an account</ButtonLink>
        </div>
      </AuthCard>
    );
  }

  if (state.kind === "failed") {
    return (
      <AuthCard eyebrow="INVITATION" title="We couldn't accept" emphasis="this invitation.">
        <ErrorNotice error={state.error} />
        {state.me && <p className="muted small">You are signed in as <b>{state.me.user.email}</b>. Invitations can only be accepted by the email address they were sent to.</p>}
        <div className="button-row">
          {state.me ? <ButtonLink href="/app">Go to your workspace</ButtonLink> : <Button onClick={() => window.location.reload()}>Try again</Button>}
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow="INVITATION" title="Joining your" emphasis="workspace…" intro={state.kind === "accepting" ? `Accepting as ${state.me.user.email}.` : "Checking your session…"}>
      <div className="center-inline" role="status"><span className="spinner" aria-hidden="true" /> One moment</div>
    </AuthCard>
  );
}
