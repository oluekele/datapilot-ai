// Types mirrored from docs/api-contract.md (v1). Keep in sync with the contract.

export type Role = "OWNER" | "ADMIN" | "MEMBER";
export type OrgKind = "INDIVIDUAL" | "TEAM";
export type OrgStatus = "ACTIVE" | "SUSPENDED";
export type PlatformRole = "USER" | "SUPER_ADMIN";

export type OrgSummary = { id: string; name: string; kind: OrgKind; role: Role; status: OrgStatus };

export type Limits = { maxDatasets: number; maxJobsPerMonth: number; maxFileMb: number; maxMembers: number };

export type EntitlementReason = "SUBSCRIPTION" | "TRIAL" | "GRACE" | "NONE" | "SUSPENDED";
export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";

export type Entitlement = {
  active: boolean;
  reason: EntitlementReason;
  plan: { code: string; name: string } | null;
  trial: { startedAt: string; expiresAt: string; active: boolean } | null;
  subscription: {
    status: SubscriptionStatus;
    planCode: string;
    planName: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    source: "PAYMENT" | "ADMIN";
  } | null;
  graceUntil: string | null;
  limits: Limits;
  usage: { datasets: number; jobsThisMonth: number; members: number };
};

export type MeUser = {
  id: string;
  email: string;
  displayName: string;
  platformRole: PlatformRole;
  onboardingCompleted: boolean;
};

export type Me = {
  user: MeUser;
  organizations: OrgSummary[];
  activeOrganization: OrgSummary | null;
  entitlement: Entitlement | null;
  stepUpUntil: string | null;
};

export type Person = { displayName: string };

export type OperationType = "EXPLORE" | "ANALYZE" | "VISUALIZE" | "TRAIN";
export type JobType = "PROFILE" | "REPAIR" | OperationType;
export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export type ProfileColumn = {
  column: string;
  data_type: string;
  missing: number;
  missing_percentage: number;
  unique_values: number;
  is_constant: boolean;
  mean?: number | null;
  median?: number | null;
  min?: number | null;
  max?: number | null;
  potential_outliers_iqr?: number;
};

export type Severity = "info" | "warning" | "high";
export type Risk = "low" | "medium" | "high";

export type Finding = { type: string; severity: Severity; column: string | null; evidence: string; recommendation?: string };

export type RepairPlanItem = {
  id: string;
  action: string;
  column: string | null;
  title: string;
  evidence: string;
  recommendation: string;
  note?: string;
  methods?: Record<string, string>;
  default_method?: string;
  risk: Risk;
};

export type ProfileResult = {
  overview: {
    rows: number;
    columns: number;
    missing_cells: number;
    missing_percentage: number;
    duplicate_rows: number;
    memory_usage_bytes: number;
  };
  columns: ProfileColumn[];
  findings: Finding[];
  repairPlan: RepairPlanItem[];
  healthScore: number;
  /** v1.1: drives the column pickers of the analysis operations. Absent on older profiles. */
  columnKinds?: Record<string, ColumnKind>;
};

export type AppliedRepair = { id: string; title: string; changed_count: number; detail: string; method?: string };

export type RepairSnapshot = { rows: number; columns: number; missing_cells: number; duplicate_rows: number };
export type RepairResult = { applied: AppliedRepair[]; before: RepairSnapshot; after: RepairSnapshot };

export type Job = {
  id: string;
  type: JobType;
  status: JobStatus;
  datasetId: string;
  datasetName?: string;
  datasetVersionId: string;
  outputVersionId: string | null;
  parameters: Record<string, unknown>;
  result: JobResult | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: Person;
};

export type JobResult = ProfileResult | RepairResult | ExploreResult | AnalyzeResult | VisualizeResult | TrainResult;

export type AdminJob = Job & { organizationName?: string };

export type VersionKind = "RAW" | "REPAIRED";

export type Version = {
  id: string;
  versionNumber: number;
  kind: VersionKind;
  parentVersionId: string | null;
  originalFilename: string;
  fileSizeBytes: number;
  sha256: string;
  rowCount: number | null;
  columnCount: number | null;
  appliedRepairs: AppliedRepair[] | null;
  purged: boolean;
  createdAt: string;
  createdBy: Person;
};

export type DatasetSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  createdBy: Person;
  versionCount: number;
  latestVersion: Version;
  lastJob: Job | null;
};

export type DatasetDetail = {
  id: string;
  name: string;
  createdAt: string;
  createdBy: Person;
  versions: Version[];
  jobs: Job[];
};

// Organisation
export type OrgMember = { userId: string; email: string; displayName: string; role: Role; joinedAt: string };
export type OrgInvitation = { id: string; email: string; role: Role; expiresAt: string; createdAt: string };
export type Organization = {
  id: string;
  name: string;
  kind: OrgKind;
  status: OrgStatus;
  members: OrgMember[];
  invitations: OrgInvitation[];
};

// Billing
export type Plan = {
  code: string;
  name: string;
  description: string;
  priceMinor: number;
  currency: string;
  interval: string;
  limits: Limits;
};

export type AdminPlan = Plan & { active: boolean; providerPlanCode: string | null };

export type Payment = {
  id: string;
  reference: string;
  amountMinor: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  planName: string | null;
};

export type BillingInfo = { entitlement: Entitlement | null; paymentsEnabled: boolean; payments: Payment[] };

// Generic responses
export type MessageResponse = { message: string };
export type RegisterResponse = { message: string; devVerificationUrl?: string };
export type ForgotPasswordResponse = { message: string; devResetUrl?: string };
export type OkResponse = { ok: boolean };

// Super-admin
export type AuditEvent = {
  id: string;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  metadata: unknown;
  createdAt: string;
  ipAddress: string | null;
  actor: { email: string } | null;
  organization: { name: string } | null;
};

export type AdminOverview = {
  users: { total: number; active: number; pendingEmail: number; suspended: number };
  organizations: { total: number; suspended: number };
  subscriptions: { active: number; pastDue: number; canceled: number };
  trials: { active: number; consumed: number };
  jobs: { queued: number; running: number; failed24h: number; succeeded24h: number };
  revenue: { last30Days: Record<string, number> };
  recentAudit: AuditEvent[];
};

export type AdminOrg = {
  id: string;
  name: string;
  slug: string;
  kind: OrgKind;
  status: OrgStatus;
  suspendedReason: string | null;
  createdAt: string;
  owner: { id: string; email: string; displayName: string } | null;
  memberCount: number;
  datasetCount: number;
  entitlement: Entitlement;
  trial: { startedAt: string; expiresAt: string; endedEarlyAt: string | null; reason: string } | null;
  trialEligible: boolean;
  trialIneligibleReason: string | null;
};

// The contract does not spell out member/payment shapes for the admin detail;
// we assume they mirror the tenant shapes and render defensively.
export type AdminOrgMember = {
  userId?: string;
  id?: string;
  email: string;
  displayName: string;
  role: Role;
  joinedAt?: string;
};

export type AdminOrgDetail = AdminOrg & {
  members: AdminOrgMember[];
  recentJobs: Job[];
  payments: Payment[];
  audit: AuditEvent[];
};

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  platformRole: PlatformRole;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  organizations: Array<{ id: string; name: string; role: Role }>;
  trialUsed: boolean;
};

// ---------------------------------------------------------------------------
// Analysis operations & downloads library (contract v1.1)
// ---------------------------------------------------------------------------

export type ColumnKind = "numeric" | "categorical" | "boolean" | "datetime" | "text" | "identifier" | "empty";
export type CorrelationMethod = "pearson" | "spearman";

// EXPLORE
export type ExploreParams = { correlationMethod?: CorrelationMethod; columns?: string[] };

/** Engine-produced summaries; fields are optional because the engine may add or omit some. */
export type ExploreSummary = {
  rows?: number;
  columns?: number;
  column_kinds?: Record<string, ColumnKind>;
  kind_counts?: Record<string, number>;
  complete_rows?: number;
  complete_row_percentage?: number;
};
export type ExploreMissing = {
  columns_with_missing?: number;
  rows_with_missing?: number;
  rows_with_missing_percentage?: number;
  by_column?: Array<{ column: string; missing: number; missing_percentage?: number }>;
};
export type DistributionStats = {
  count?: number;
  missing?: number;
  mean?: number | null;
  std?: number | null;
  min?: number | null;
  q1?: number | null;
  median?: number | null;
  q3?: number | null;
  max?: number | null;
  skewness?: number | null;
  kurtosis?: number | null;
  notes?: string[];
  [key: string]: unknown;
};
export type CategoryFrequency = { value: string; count: number; percentage: number };
export type CorrelationPair = { column_a: string; column_b: string; correlation: number; strength: string; n?: number };
export type ExploreResult = {
  summary: ExploreSummary;
  missing: ExploreMissing;
  distributions: Array<{ column: string; stats: DistributionStats }>;
  categories: Array<{ column: string; frequencies: CategoryFrequency[] }>;
  correlations: { method: CorrelationMethod | string; top: CorrelationPair[] };
};

// ANALYZE
export type AnalyzeTest = "descriptive" | "grouped_summary" | "compare_groups" | "association" | "correlation";
export type AnalyzeParams =
  | { test: "descriptive"; columns?: string[] }
  | { test: "grouped_summary"; groupColumn: string; valueColumn: string }
  | { test: "compare_groups"; groupColumn: string; valueColumn: string; alpha?: number }
  | { test: "association"; columnA: string; columnB: string; alpha?: number }
  | { test: "correlation"; columnX: string; columnY: string; method?: CorrelationMethod; alpha?: number };
export type AnalyzeResult = {
  test: AnalyzeTest | string;
  title: string;
  summary: string;
  table?: Array<Record<string, unknown>>;
  details: Record<string, unknown>;
};

// VISUALIZE
export type ChartType = "histogram" | "box" | "bar" | "scatter" | "line" | "correlation_heatmap";
export type Aggregation = "count" | "mean" | "median" | "sum" | "min" | "max";
export type ChartFilter = { column: string; values?: string[]; minValue?: number; maxValue?: number };
export type ChartSpec = {
  chartType: ChartType;
  x?: string;
  y?: string;
  group?: string;
  aggregation?: Aggregation;
  bins?: number;
  title?: string;
  filters?: ChartFilter[];
};
export type ChartFormat = "png" | "svg";
export type VisualizeParams = { charts: ChartSpec[]; formats?: ChartFormat[] };
export type VisualizeResult = { charts: Array<{ title: string; description: string }> };

// TRAIN
export type TrainTask = "classification" | "regression" | "clustering";
export type TrainParams = {
  task: TrainTask;
  target?: string;
  algorithms?: string[];
  features?: string[];
  testSize?: number;
  cvFolds?: number;
  nClusters?: number;
};
export type LeaderboardRow = {
  algorithm: string;
  label: string;
  metrics: Record<string, number | null>;
  cvScore?: number | null;
  fitSeconds: number;
};
export type TrainResult = {
  task: TrainTask;
  target: string | null;
  features: string[];
  rows: { train: number; test: number };
  findings: Finding[];
  leaderboard: LeaderboardRow[];
  primaryMetric: string;
  best: { algorithm: string; label: string; metrics: Record<string, number | null> };
  featureImportance: Array<{ feature: string; importance: number }> | null;
  clusters?: Array<{ cluster: number | string; size: number }>;
};

export type OperationParams = {
  EXPLORE: ExploreParams;
  ANALYZE: AnalyzeParams;
  VISUALIZE: VisualizeParams;
  TRAIN: TrainParams;
};

// Artifacts (downloads library)
export type ArtifactKind = "CHART" | "TABLE" | "MODEL" | "REPORT" | "CODE" | "DATA";
export type Artifact = {
  id: string;
  kind: ArtifactKind;
  title: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  datasetId: string;
  datasetName: string;
  datasetVersionId: string;
  versionNumber: number;
  jobId: string;
  jobType: JobType;
  createdAt: string;
  createdBy: Person;
  previewable: boolean;
  metadata: Record<string, unknown> | null;
};
export type ArtifactPage = { items: Artifact[]; nextCursor: string | null };
export type ArtifactFilters = { datasetId?: string; jobId?: string; kind?: ArtifactKind; q?: string };
