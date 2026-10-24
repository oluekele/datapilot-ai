# DataPilot API contract (v1)

Base path: `/api/v1`. The Next.js app proxies `/api/v1/*` to the NestJS API
(see `apps/web/next.config.ts`), so the browser only ever talks to its own
origin and the session cookie is first-party.

## Conventions

- Session: `dp_session` cookie (HttpOnly, SameSite=Lax, Secure in production).
  The browser never sees a token.
- CSRF: every non-GET request **must** send `X-Requested-With: datapilot`, and
  the `Origin` header (if present) must match `WEB_ORIGIN`. Use
  `credentials: "same-origin"`.
- Errors: `{ statusCode, code?, message }`. `message` is safe to show. Notable
  `code`s: `UNAUTHENTICATED` (401), `EMAIL_NOT_VERIFIED` (403),
  `ACCOUNT_LOCKED` (429), `ACCOUNT_SUSPENDED` (403), `ORG_SUSPENDED` (403),
  `SUBSCRIPTION_REQUIRED` (402), `PLAN_LIMIT` (402), `FORBIDDEN_ROLE` (403),
  `STEP_UP_REQUIRED` (403), `TRIAL_ALREADY_USED` (409), `NOT_FOUND` (404).
- All dates are ISO strings. Money is integer minor units (kobo for NGN).
- The active organisation is held in the session (switch with
  `POST /auth/switch-organization`). Clients never pass an organisation id to
  tenant endpoints.

## Shared shapes

```ts
type Role = "OWNER" | "ADMIN" | "MEMBER";
type OrgSummary = { id: string; name: string; kind: "INDIVIDUAL" | "TEAM"; role: Role; status: "ACTIVE" | "SUSPENDED" };

type Limits = { maxDatasets: number; maxJobsPerMonth: number; maxFileMb: number; maxMembers: number };
type Entitlement = {
  active: boolean;                       // may upload / process
  reason: "SUBSCRIPTION" | "TRIAL" | "GRACE" | "NONE" | "SUSPENDED";
  plan: { code: string; name: string } | null;
  trial: { startedAt: string; expiresAt: string; active: boolean } | null;
  subscription: { status: "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE"; planCode: string; planName: string;
                  currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; source: "PAYMENT" | "ADMIN" } | null;
  graceUntil: string | null;
  limits: Limits;
  usage: { datasets: number; jobsThisMonth: number; members: number };
};

type Me = {
  user: { id: string; email: string; displayName: string; platformRole: "USER" | "SUPER_ADMIN"; onboardingCompleted: boolean };
  organizations: OrgSummary[];
  activeOrganization: OrgSummary | null;
  entitlement: Entitlement | null;
  stepUpUntil: string | null;            // admin step-up window end
};

type Person = { displayName: string };
type Job = {
  id: string; type: "PROFILE" | "REPAIR"; status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  datasetId: string; datasetName?: string; datasetVersionId: string; outputVersionId: string | null;
  parameters: Record<string, unknown>; result: ProfileResult | RepairResult | null; errorMessage: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; createdBy: Person;
};
type Version = {
  id: string; versionNumber: number; kind: "RAW" | "REPAIRED"; parentVersionId: string | null;
  originalFilename: string; fileSizeBytes: number; sha256: string; rowCount: number | null; columnCount: number | null;
  appliedRepairs: AppliedRepair[] | null; purged: boolean; createdAt: string; createdBy: Person;
};

// PROFILE result (from the Python engine)
type ProfileResult = {
  overview: { rows: number; columns: number; missing_cells: number; missing_percentage: number; duplicate_rows: number; memory_usage_bytes: number };
  columns: Array<{ column: string; data_type: string; missing: number; missing_percentage: number; unique_values: number;
                   is_constant: boolean; mean?: number | null; median?: number | null; min?: number | null; max?: number | null;
                   potential_outliers_iqr?: number }>;
  findings: Array<{ type: string; severity: "info" | "warning" | "high"; column: string | null; evidence: string; recommendation?: string }>;
  repairPlan: Array<{ id: string; action: string; column: string | null; title: string; evidence: string; recommendation: string;
                      note?: string; methods?: Record<string, string>; default_method?: string; risk: "low" | "medium" | "high" }>;
  healthScore: number;                   // 0-100 heuristic
};
type AppliedRepair = { id: string; title: string; changed_count: number; detail: string; method?: string };
type RepairResult = {
  applied: AppliedRepair[];
  before: { rows: number; columns: number; missing_cells: number; duplicate_rows: number };
  after:  { rows: number; columns: number; missing_cells: number; duplicate_rows: number };
};
```

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ accountType: "INDIVIDUAL"\|"TEAM", displayName, email, password (min 10), organizationName? (required for TEAM) }` | `201 { message, devVerificationUrl? }` (no login until verified) |
| POST | `/auth/verify-email` | `{ token }` | `{ message }` — also starts the account's one-time free trial |
| POST | `/auth/resend-verification` | `{ email }` | `{ message, devVerificationUrl? }` |
| POST | `/auth/login` | `{ email, password }` | `Me` + cookie |
| POST | `/auth/logout` | – | `{ ok: true }` |
| POST | `/auth/forgot-password` | `{ email }` | `{ message, devResetUrl? }` |
| POST | `/auth/reset-password` | `{ token, password }` | `{ message }` (revokes all sessions) |
| GET | `/auth/me` | – | `Me` (401 if not signed in) |
| POST | `/auth/onboarding/complete` | – | `{ ok: true }` |
| POST | `/auth/switch-organization` | `{ organizationId }` | `Me` |
| POST | `/auth/step-up` | `{ password }` | `{ stepUpUntil }` |

`dev*Url` fields are only returned when `NODE_ENV !== "production"` and no SMTP
server is configured, so local development works without email.

## Organisation (active organisation)

| Method | Path | Roles | Body / Response |
|---|---|---|---|
| GET | `/organization` | any | `{ id, name, kind, status, members: [{ userId, email, displayName, role, joinedAt }], invitations: [{ id, email, role, expiresAt, createdAt }] }` |
| PATCH | `/organization` | OWNER, ADMIN | `{ name }` |
| POST | `/organization/invitations` | OWNER, ADMIN (TEAM only) | `{ email, role: "ADMIN"\|"MEMBER" }` → `{ id, devInviteUrl? }` |
| DELETE | `/organization/invitations/:id` | OWNER, ADMIN | `{ ok }` |
| PATCH | `/organization/members/:userId` | OWNER | `{ role: "ADMIN"\|"MEMBER" }` |
| DELETE | `/organization/members/:userId` | OWNER, ADMIN | `{ ok }` (owner cannot be removed) |
| POST | `/invitations/accept` | signed in, email must match | `{ token }` → `Me` |

## Datasets & history

Reading and downloading stay available without a subscription (your data is
never held hostage). Uploading and processing require `entitlement.active`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/datasets` | – | `[{ id, name, createdAt, updatedAt, createdBy, versionCount, latestVersion: Version, lastJob: Job \| null }]` |
| POST | `/datasets` | multipart: `file` (.csv/.xlsx), `name?` | `{ id }` (a PROFILE job is queued automatically) |
| GET | `/datasets/:id` | – | `{ id, name, createdAt, createdBy, versions: Version[], jobs: Job[] }` (newest first) |
| DELETE | `/datasets/:id` | – | `{ ok }` — deletes stored files; metadata kept for audit |
| GET | `/datasets/:id/versions/:versionId/download` | – | file attachment |
| GET | `/datasets/:id/versions/:versionId/report` | – | Markdown attachment (latest successful profile) |
| POST | `/datasets/:id/versions/:versionId/profile` | – | `Job` |
| POST | `/datasets/:id/versions/:versionId/repairs` | `{ actions: string[], methods?: Record<string,string> }` | `Job` (creates a new REPAIRED version, then profiles it) |
| GET | `/jobs?limit=50` | – | `Job[]` with `datasetName` (organisation history) |
| GET | `/jobs/:id` | – | `Job` |

## Billing

| Method | Path | Roles | Body / Response |
|---|---|---|---|
| GET | `/billing/plans` | public | `[{ code, name, description, priceMinor, currency, interval, limits }]` |
| GET | `/billing/trial` | public | `{ days, automatic, limits }` — the free trial every new account gets on email verification |
| GET | `/billing` | any member | `{ entitlement, paymentsEnabled, payments: [{ id, reference, amountMinor, currency, status, paidAt, createdAt, planName }] }` |
| POST | `/billing/checkout` | OWNER, ADMIN | `{ planCode }` → `{ authorizationUrl, reference }` (redirect the browser) |
| POST | `/billing/verify` | any member | `{ reference }` → `{ status }` (call on return to `/app/billing?reference=…`) |
| POST | `/billing/cancel` | OWNER, ADMIN | `{ ok }` — stops renewal at period end |
| POST | `/billing/webhooks/paystack` | Paystack | signature-verified |

## Super-admin (platformRole SUPER_ADMIN)

All mutations require a recent step-up (`POST /auth/step-up`, valid 15
minutes) and a `reason` (min 5 chars); otherwise `403 STEP_UP_REQUIRED`. Every
mutation writes an audit event.

| Method | Path | Body / Response |
|---|---|---|
| GET | `/admin/overview` | `{ users: { total, active, pendingEmail, suspended }, organizations: { total, suspended }, subscriptions: { active, pastDue, canceled }, trials: { active, consumed }, jobs: { queued, running, failed24h, succeeded24h }, revenue: { last30Days: Record<currency, minor> }, recentAudit: AuditEvent[] }` |
| GET | `/admin/organizations?q=&status=` | `AdminOrg[]` |
| GET | `/admin/organizations/:id` | `AdminOrg & { members, recentJobs: Job[], payments, audit: AuditEvent[] }` |
| POST | `/admin/organizations/:id/suspend` · `/reactivate` | `{ reason }` |
| POST | `/admin/organizations/:id/trial` | `{ days (1–90), reason }` → `409 TRIAL_ALREADY_USED` if the organisation **or its owner** ever had a trial |
| POST | `/admin/organizations/:id/trial/end` | `{ reason }` (the trial stays consumed) |
| POST | `/admin/organizations/:id/subscription` | `{ planCode, months (1–24), reason }` — manual activation (e.g. bank transfer) |
| POST | `/admin/organizations/:id/subscription/cancel` | `{ reason }` |
| GET | `/admin/users?q=` | `[{ id, email, displayName, status, platformRole, emailVerifiedAt, lastLoginAt, createdAt, organizations: [{ id, name, role }], trialUsed }]` |
| POST | `/admin/users/:id/suspend` · `/reactivate` | `{ reason }` (suspending revokes sessions) |
| GET | `/admin/jobs?status=` | `Job[]` with `organizationName`, `datasetName` |
| GET | `/admin/audit?action=&organizationId=` | `AuditEvent[]` |
| GET | `/admin/plans` | plans incl. inactive and `providerPlanCode` |
| PATCH | `/admin/plans/:code` | `{ priceMinor?, providerPlanCode?, active?, limits?, reason }` |

```ts
type AdminOrg = {
  id: string; name: string; slug: string; kind: "INDIVIDUAL" | "TEAM"; status: "ACTIVE" | "SUSPENDED"; suspendedReason: string | null;
  createdAt: string; owner: { id: string; email: string; displayName: string } | null;
  memberCount: number; datasetCount: number;
  entitlement: Entitlement;
  trial: { startedAt: string; expiresAt: string; endedEarlyAt: string | null; reason: string } | null;
  trialEligible: boolean; trialIneligibleReason: string | null;
};
type AuditEvent = { id: string; action: string; subjectType: string | null; subjectId: string | null; metadata: unknown;
                    createdAt: string; ipAddress: string | null; actor: { email: string } | null; organization: { name: string } | null };
```

## Analysis operations & the downloads library (v1.1)

Every analysis runs as a background **job** on one dataset version and may
produce downloadable **artifacts** (charts, tables, models, reports, code).
All operations are billable runs (count toward `maxJobsPerMonth`) and need an
active entitlement (trial or subscription).

### Operations

`POST /datasets/:id/versions/:versionId/operations` with
`{ operation: "EXPLORE" | "ANALYZE" | "VISUALIZE" | "TRAIN", params: object }`
→ `Job` (same shape as other jobs; `type` is the operation). Poll the dataset
detail or `GET /jobs/:id` until `SUCCEEDED`/`FAILED`. Parameter mistakes come
back as a `FAILED` job whose `errorMessage` is safe to show.

Column names and kinds for pickers come from the version's latest PROFILE
result: `result.columnKinds: Record<column, "numeric" | "categorical" | "boolean" | "datetime" | "text" | "identifier" | "empty">`.

| operation | params | result (job.result) |
|---|---|---|
| `EXPLORE` | `{ correlationMethod?: "pearson" \| "spearman", columns?: string[] }` (`columns` limits distribution charts; default: automatic, max 12 numeric + 8 categorical) | `{ summary, missing, distributions: [{ column, stats }], categories: [{ column, frequencies: [{ value, count, percentage }] }], correlations: { method, top: [{ column_a, column_b, correlation, strength }] } }` |
| `ANALYZE` | `{ test: "descriptive", columns?: string[] }` · `{ test: "grouped_summary", groupColumn, valueColumn }` · `{ test: "compare_groups", groupColumn, valueColumn, alpha? }` · `{ test: "association", columnA, columnB, alpha? }` · `{ test: "correlation", columnX, columnY, method?: "pearson" \| "spearman", alpha? }` | `{ test, title, summary: string, table?: Record<string, unknown>[], details: object }` — `summary` is a plain-language interpretation |
| `VISUALIZE` | `{ charts: ChartSpec[] (1–12), formats?: ("png" \| "svg")[] }` where `ChartSpec = { chartType: "histogram" \| "box" \| "bar" \| "scatter" \| "line" \| "correlation_heatmap", x?, y?, group?, aggregation?: "count" \| "mean" \| "median" \| "sum" \| "min" \| "max", bins?, title?, filters?: [{ column, values?, minValue?, maxValue? }] }` | `{ charts: [{ title, description }] }` |
| `TRAIN` | `{ task: "classification" \| "regression" \| "clustering", target? (required unless clustering), algorithms?: string[], features?: string[], testSize?: 0.1–0.5, cvFolds?: 0 \| 3–10, nClusters?: 2–20 }` | see below |

Algorithms (default: all for the task):
- classification: `logistic_regression`, `decision_tree`, `random_forest`, `gradient_boosting`, `knn`, `svm`, `naive_bayes`
- regression: `linear_regression`, `ridge`, `lasso`, `decision_tree`, `random_forest`, `gradient_boosting`, `knn`, `svr`
- clustering: `kmeans`, `agglomerative`, `gaussian_mixture`

TRAIN result:
```ts
{
  task, target: string | null, features: string[], rows: { train: number, test: number },
  findings: Finding[],                       // leakage / suitability warnings
  leaderboard: [{ algorithm, label, metrics: Record<string, number | null>, cvScore?: number | null, fitSeconds }],
  primaryMetric: string,                     // e.g. "f1_weighted", "r2", "silhouette"
  best: { algorithm, label, metrics },
  featureImportance: [{ feature, importance }] | null,   // permutation importance of the best model, top 20
  clusters?: [{ cluster, size }]             // clustering only
}
```

### Artifacts (downloads library)

```ts
type Artifact = {
  id: string; kind: "CHART" | "TABLE" | "MODEL" | "REPORT" | "CODE" | "DATA";
  title: string; filename: string; contentType: string; sizeBytes: number;
  datasetId: string; datasetName: string; datasetVersionId: string; versionNumber: number;
  jobId: string; jobType: Job["type"]; createdAt: string; createdBy: { displayName: string };
  previewable: boolean;                      // true for PNG charts
  metadata: Record<string, unknown> | null;
};
```

| Method | Path | Notes |
|---|---|---|
| GET | `/artifacts?datasetId=&jobId=&kind=&q=&limit=&cursor=` | newest first, `{ items: Artifact[], nextCursor: string \| null }` |
| GET | `/artifacts/:id/download` | attachment |
| GET | `/artifacts/:id/preview` | inline PNG for `previewable` artifacts (use as `<img src>`) |
| GET | `/artifacts/archive?ids=a,b,c` or `?datasetId=&jobId=&kind=` | ZIP of up to 200 artifacts |
| DELETE | `/artifacts/:id` | uploader, OWNER or ADMIN |

Dataset deletion deletes its artifacts' files too.

### Worker protocol (API ↔ Python)

stdin: `{ type, input_path, filename, dataset_name, output_dir, output_path, max_file_mb, params }`.
stdout: `{ ok: true, result, artifacts: [{ file, kind, title, content_type, metadata? }] }`
or `{ ok: false, error }`. `file` is a bare filename inside `output_dir`; the API
encrypts and stores each one and deletes the temp directory. PROFILE and
REPAIR keep their existing behaviour (REPAIR still writes `output_path`).
