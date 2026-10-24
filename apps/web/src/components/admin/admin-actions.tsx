"use client";

import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMe } from "@/components/me-provider";
import { Button, ErrorNotice, Field, Modal } from "@/components/ui";
import { apiPost, isApiError } from "@/lib/api";
import { isFuture } from "@/lib/format";

const MIN_REASON = 5;

export type AdminActionRequest = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Performs the mutation with the reason the admin entered. */
  perform: (reason: string) => Promise<unknown>;
  onDone?: () => void | Promise<void>;
};

type RunAdminAction = (request: AdminActionRequest) => Promise<boolean>;

const AdminActionContext = createContext<RunAdminAction | null>(null);

/**
 * Every super-admin mutation goes through here: it collects a reason
 * (min 5 chars), ensures a fresh step-up (password re-entry) and retries once
 * if the API answers STEP_UP_REQUIRED.
 */
export function AdminActionProvider({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const [stepUpUntil, setStepUpUntil] = useState<string | null>(me?.stepUpUntil ?? null);
  const [request, setRequest] = useState<AdminActionRequest | null>(null);
  const [phase, setPhase] = useState<"reason" | "step-up">("reason");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const run = useCallback<RunAdminAction>((next) => {
    resolver.current?.(false);
    setRequest(next);
    setPhase("reason");
    setReason("");
    setPassword("");
    setError(null);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function finish(ok: boolean): void {
    resolver.current?.(ok);
    resolver.current = null;
    setRequest(null);
    setPassword("");
  }

  async function execute(current: AdminActionRequest, why: string): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await current.perform(why);
      await current.onDone?.();
      finish(true);
    } catch (err) {
      if (isApiError(err, "STEP_UP_REQUIRED")) {
        setStepUpUntil(null);
        setPhase("step-up");
      } else {
        setError(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReason(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!request || reason.trim().length < MIN_REASON) return;
    if (!isFuture(stepUpUntil)) {
      setError(null);
      setPhase("step-up");
      return;
    }
    await execute(request, reason.trim());
  }

  async function submitStepUp(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!request || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiPost<{ stepUpUntil: string }>("/auth/step-up", { password });
      setStepUpUntil(result.stepUpUntil);
      setPassword("");
      setPhase("reason");
    } catch (err) {
      setError(err);
      setSubmitting(false);
      return;
    }
    await execute(request, reason.trim());
  }

  const reasonTooShort = reason.trim().length < MIN_REASON;

  return (
    <AdminActionContext.Provider value={run}>
      {children}
      <Modal
        open={request !== null}
        eyebrow={phase === "step-up" ? "CONFIRM IT'S YOU" : "AUDITED ACTION"}
        title={phase === "step-up" ? "Re-enter your password" : request?.title ?? ""}
        onClose={() => finish(false)}
        locked={submitting}
      >
        {phase === "reason" ? (
          <form className="form-stack" onSubmit={(event) => void submitReason(event)}>
            {request?.description && <div className="modal-description">{request.description}</div>}
            <Field label="Reason" hint={`Recorded in the audit log. At least ${MIN_REASON} characters.`}>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required minLength={MIN_REASON} maxLength={500} autoFocus />
            </Field>
            <ErrorNotice error={error} />
            <div className="modal-foot-inline">
              <Button variant="ghost" onClick={() => finish(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" variant={request?.danger ? "danger" : "dark"} loading={submitting} disabled={reasonTooShort}>
                {request?.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </form>
        ) : (
          <form className="form-stack" onSubmit={(event) => void submitStepUp(event)}>
            <p className="muted small">Administrative changes need a recent password confirmation. It stays valid for 15 minutes.</p>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" autoFocus />
            </Field>
            <ErrorNotice error={error} />
            <div className="modal-foot-inline">
              <Button variant="ghost" onClick={() => setPhase("reason")} disabled={submitting}>Back</Button>
              <Button type="submit" loading={submitting}>Confirm & continue</Button>
            </div>
          </form>
        )}
      </Modal>
    </AdminActionContext.Provider>
  );
}

export function useAdminAction(): RunAdminAction {
  const value = useContext(AdminActionContext);
  if (!value) throw new Error("useAdminAction must be used inside <AdminActionProvider>");
  return value;
}
