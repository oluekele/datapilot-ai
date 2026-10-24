# DataPilot SaaS migration plan

## Product architecture

- `apps/web`: Next.js App Router user interface and onboarding.
- `apps/api`: NestJS JSON API; the trusted boundary for authentication, tenant access, trials, plans, and admin actions.
- PostgreSQL: identity references, organisations, memberships, plan/subscription state, trial history, dataset/version metadata, jobs, and audit events.
- Private object storage: raw and repaired file bytes. Store opaque object keys and checksums in PostgreSQL; never expose a bucket or filesystem path directly to a browser.
- Existing Python analysis modules: keep as an internal processing engine initially. Call it from queued jobs; do not expose it as a public API or rewrite validated statistics as part of the first migration.

The current Streamlit application remains available during the migration. New SaaS code is additive, and the legacy app should only be removed after feature parity, data migration, and production checks.

## What is implemented

See [api-contract.md](api-contract.md) for every endpoint and payload.

- **Identity:** registration as an individual or an organisation, email
  verification, Argon2id passwords, login lockout after 5 failures, password
  reset (revokes all sessions), opaque server-side sessions in an HttpOnly
  cookie, CSRF protection (custom header + Origin allow-list), strict rate
  limits on credential endpoints.
- **Organisations:** owner/admin/member roles, invitations by email,
  organisation switching. Every tenant query is scoped server-side to the
  session's active membership, re-checked on each request.
- **Commercial rules** (`EntitlementsService` is the single source of truth):
  - Every new account (individual or organisation) starts a free trial
    (`TRIAL_DAYS`, default 14; 0 disables) when its email is verified. After
    that, uploading and processing need a subscription.
  - The trial is **one-time per organisation and per owner**: ending it early
    does not make it available again, and an owner cannot get a second trial by
    creating a new organisation. Enforced by an eligibility check, a
    per-organisation advisory lock, and unique constraints.
  - Super-admins can end a trial early, grant one to an organisation that never
    had one, or activate a subscription manually.
  - Plan limits (datasets, monthly processing runs, file size, members) are
    checked in the same transaction as the write.
  - Failed renewals get a configurable grace period (`BILLING_GRACE_DAYS`).
  - Without a subscription, data stays readable and downloadable; uploads and
    processing are blocked.
- **Billing:** Paystack checkout (with plan codes for recurring billing),
  return-URL verification, signature-verified idempotent webhooks; charges are
  re-fetched from Paystack before money-affecting changes. Super-admins can
  activate plans manually (e.g. bank transfer).
- **Data lifecycle:** uploads are stored AES-256-GCM encrypted under opaque
  keys. The RAW version is immutable; each repair creates a new REPAIRED
  version linked to its parent with the applied operations recorded. Deleting
  a dataset purges the file bytes but keeps the audit history.
- **Processing:** a Postgres-backed job queue (`FOR UPDATE SKIP LOCKED`) runs
  the existing Python engine (`python -m datapilot.worker`) in an isolated
  subprocess with a minimal environment and a timeout; crashed jobs are
  retried up to 3 times.
- **Super-admin:** overview metrics, organisations (suspend, grant/end trial,
  activate/cancel subscription), users (suspend revokes sessions), jobs,
  audit log, plan editor. Admin mutations need a password step-up within 15
  minutes and a written reason, and are audited. Super-admins are created only
  from the shell (`npm run admin:promote -- email`).
- **Web app:** onboarding walkthrough modal on first sign-in (re-openable),
  dataset workspace, version history and comparison, team, billing, and the
  admin dashboard.

## Before production

- Replace local encrypted file storage with private S3-compatible storage
  (same `StorageService` interface) and manage `STORAGE_ENCRYPTION_KEY` in a
  secrets manager.
- Configure `SMTP_URL`, `PAYSTACK_SECRET_KEY` (live) and the Paystack plan
  codes in the admin plan editor; register the webhook URL
  `https://<api>/api/v1/billing/webhooks/paystack`; test the full payment
  cycle in Paystack test mode, including a failed renewal.
- Serve over TLS (`NODE_ENV=production` makes cookies `Secure`), run
  `prisma migrate deploy`, use a least-privilege database user, encrypted
  backups with tested restores, monitoring/alerting on failed jobs and
  webhooks, and a written data-retention policy.
- Consider a dedicated queue and separate worker process once volume grows,
  and an independent security review / penetration test before taking real
  customer data.

## Security invariants to preserve

1. Every authenticated API request is authorized against the active organisation membership. A browser-supplied organisation ID is never proof of access.
2. Every dataset, version, job, and report query is scoped to the authorised organisation. Never accept a raw storage key from a client for download.
3. The raw upload is immutable. A repair creates a new version linked to its parent and records the repair plan and checksum.
4. Trials start automatically on email verification (or by super-admin grant) and are recorded once for both the organisation and its owner using unique database constraints. Rows are never deleted, so a trial can never be restarted.
5. Subscription entitlements are checked in the API for every paid operation. Webhook event IDs are persisted uniquely before state changes are applied.
6. Passwords use Argon2id; sessions are random opaque tokens stored hashed, with idle and absolute expiry, and are revocable instantly. Cookies are HttpOnly, Secure in production, SameSite, and protected against CSRF where cross-site flows require it.
7. Super-admin actions require a platform role, step-up authentication, reason capture, and an append-only audit event.
8. Secrets, uploaded data, passwords, tokens, and full payment payloads must not be written to logs.

## Staged delivery

1. ✅ **Foundation:** monorepo, Postgres/Prisma schema, web shell, health checks.
2. ✅ **Identity and organisations:** email verification, login/session lifecycle, organisation creation/invites, role checks, onboarding after registration.
3. ✅ (local encrypted storage) **Private data lifecycle:** object storage, signed upload/download flows, immutable raw/repaired versions, retention/deletion, scoped history.
4. ✅ **Processing:** job queue, Python worker adapter, result persistence, retries/idempotency, usage metering.
5. ✅ (needs live Paystack testing) **Commercial access:** plans and API entitlements, one-time trial claims, auditable admin exceptions, chosen payment gateway and webhook verification.
6. 🟡 (dashboard and controls done; backups/monitoring outstanding) **Platform operations:** super-admin dashboard, suspension controls, metrics, security events, backups, restore drills, rate/abuse controls, deployment hardening.

Do not deploy this development Compose setup with real data. Production requires TLS, managed secrets, private object storage, encrypted backups, least-privilege database credentials, monitoring, a documented retention policy, and tested restore procedures.
