/**
 * End-to-end checks against a running API and database.
 *   npm run start --workspace @datapilot/api   (in another terminal)
 *   npm run test:e2e --workspace @datapilot/api
 * Creates throwaway users with random emails; safe to run repeatedly on a dev DB.
 *
 * The API under test must have email delivery OFF (no SMTP_HOST/SMTP_URL): the
 * tests read verification links from API responses, and must not send real
 * mail to fake addresses. With SMTP configured in .env, start a test instance:
 *   SMTP_HOST= SMTP_URL= API_PORT=4100 node dist/main.js
 *   API_URL=http://127.0.0.1:4100/api/v1 npm run test:e2e
 */
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const API = process.env.API_URL ?? "http://127.0.0.1:4000/api/v1";
const ORIGIN = (process.env.WEB_ORIGIN ?? "http://localhost:3100").split(",")[0];
const prisma = new PrismaClient();
const PASSWORD = "correct horse battery";
const CSV = readFileSync(resolve(__dirname, "../../../examples/customer_churn.csv"));

class Client {
  cookie = "";
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(method === "GET" ? {} : { "X-Requested-With": "datapilot", Origin: ORIGIN }),
        ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }
  get = (p: string) => this.call("GET", p);
  post = (p: string, b?: unknown) => this.call("POST", p, b ?? {});
}

const email = (tag: string) => `${tag}-${randomBytes(4).toString("hex")}@example.test`;

async function signUp(tag: string, accountType: "INDIVIDUAL" | "TEAM" = "TEAM") {
  const c = new Client();
  const address = email(tag);
  const reg = await c.post("/auth/register", {
    accountType,
    displayName: tag,
    email: address,
    password: PASSWORD,
    organizationName: `${tag} Ltd`,
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const token = new URL(reg.body.devVerificationUrl).searchParams.get("token");
  assert.equal((await c.post("/auth/verify-email", { token })).status, 200);
  const login = await c.post("/auth/login", { email: address, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { c, email: address, me: login.body };
}

async function upload(c: Client) {
  const form = new FormData();
  form.append("file", new Blob([CSV], { type: "text/csv" }), "customer_churn.csv");
  return c.call("POST", "/datasets", form);
}

async function waitForJobs(c: Client, datasetId: string) {
  for (let i = 0; i < 240; i++) {
    const d = await c.get(`/datasets/${datasetId}`);
    if (d.body.jobs.every((j: { status: string }) => !["QUEUED", "RUNNING"].includes(j.status))) return d.body;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("jobs did not finish");
}

describe("DataPilot API", () => {
  let owner: Awaited<ReturnType<typeof signUp>>;
  let admin: Awaited<ReturnType<typeof signUp>>;
  let datasetId = "";

  before(async () => {
    owner = await signUp("owner");
    admin = await signUp("admin", "INDIVIDUAL");
    await prisma.user.update({ where: { email: admin.email }, data: { platformRole: "SUPER_ADMIN" } });
  });
  after(() => prisma.$disconnect());

  test("unverified users cannot sign in, and registration does not reveal existing emails", async () => {
    const c = new Client();
    const address = email("pending");
    const body = { accountType: "INDIVIDUAL", displayName: "Pending", email: address, password: PASSWORD };
    const first = await c.post("/auth/register", body);
    const again = await c.post("/auth/register", body);
    assert.equal(first.body.message, again.body.message);
    const login = await c.post("/auth/login", { email: address, password: PASSWORD });
    assert.equal(login.body.code, "EMAIL_NOT_VERIFIED");
  });

  test("CSRF: state-changing requests need the custom header and a trusted origin", async () => {
    const noHeader = await owner.c.call("POST", "/auth/onboarding/complete", {}, { "X-Requested-With": "" });
    assert.equal(noHeader.status, 403);
    const evil = await owner.c.call("POST", "/auth/onboarding/complete", {}, { Origin: "https://evil.example" });
    assert.equal(evil.status, 403);
  });

  test("new accounts start a one-time free trial when they verify their email", async () => {
    assert.equal(owner.me.entitlement.active, true);
    assert.equal(owner.me.entitlement.reason, "TRIAL");
    assert.equal(owner.me.entitlement.trial.active, true);
    const policy = await new Client().get("/billing/trial");
    const days = Math.round((Date.parse(owner.me.entitlement.trial.expiresAt) - Date.now()) / 86_400_000);
    assert.equal(days, policy.body.days);
  });

  test("admin endpoints require super-admin and a recent password step-up", async () => {
    assert.equal((await owner.c.get("/admin/overview")).status, 403);
    assert.equal((await admin.c.get("/admin/overview")).status, 200);
    const orgId = owner.me.activeOrganization.id;
    const noStepUp = await admin.c.post(`/admin/organizations/${orgId}/trial`, { days: 14, reason: "pilot customer" });
    assert.equal(noStepUp.body.code, "STEP_UP_REQUIRED");
    assert.equal((await admin.c.post("/auth/step-up", { password: "wrong password!" })).status, 401);
    assert.equal((await admin.c.post("/auth/step-up", { password: PASSWORD })).status, 200);
  });

  test("the trial cannot be granted again, and once ended a subscription is required", async () => {
    const orgId = owner.me.activeOrganization.id;
    const again = await admin.c.post(`/admin/organizations/${orgId}/trial`, { days: 14, reason: "second try" });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "TRIAL_ALREADY_USED");

    const ended = await admin.c.post(`/admin/organizations/${orgId}/trial/end`, { reason: "testing end" });
    assert.equal(ended.status, 200);
    assert.equal(ended.body.entitlement.reason, "NONE");
    const res = await upload(owner.c);
    assert.equal(res.status, 402);
    assert.equal(res.body.code, "SUBSCRIPTION_REQUIRED");

    // Ending early does not make the organisation eligible again.
    const afterEnd = await admin.c.post(`/admin/organizations/${orgId}/trial`, { days: 7, reason: "third try" });
    assert.equal(afterEnd.body.code, "TRIAL_ALREADY_USED");
  });

  test("the same owner cannot get a second trial through a new organisation", async () => {
    // Simulate the owner creating a second organisation.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    const org = await prisma.organization.create({
      data: {
        name: "Second Co",
        slug: `second-${randomBytes(3).toString("hex")}`,
        createdById: user.id,
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    const res = await admin.c.post(`/admin/organizations/${org.id}/trial`, { days: 14, reason: "loophole attempt" });
    assert.equal(res.body.code, "TRIAL_ALREADY_USED");
    assert.match(res.body.message, /owner/);
  });

  test("subscription activation, upload, profile and repair produce linked versions", async () => {
    const orgId = owner.me.activeOrganization.id;
    const sub = await admin.c.post(`/admin/organizations/${orgId}/subscription`, { planCode: "team", months: 1, reason: "bank transfer" });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal(sub.body.entitlement.reason, "SUBSCRIPTION");

    const res = await upload(owner.c);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    datasetId = res.body.id;
    let detail = await waitForJobs(owner.c, datasetId);
    const profile = detail.jobs[0];
    assert.equal(profile.status, "SUCCEEDED", profile.errorMessage);
    assert.equal(profile.result.overview.rows, 403);
    assert.equal(profile.result.reportMarkdown, undefined, "report is served separately");
    const raw = detail.versions[0];

    const repair = await owner.c.post(`/datasets/${datasetId}/versions/${raw.id}/repairs`, {
      actions: ["drop_duplicate_rows", "missing::city"],
      methods: { "missing::city": "fill_unknown" },
    });
    assert.equal(repair.status, 201, JSON.stringify(repair.body));
    detail = await waitForJobs(owner.c, datasetId);
    const repaired = detail.versions.find((v: { kind: string }) => v.kind === "REPAIRED");
    assert.ok(repaired);
    assert.equal(repaired.parentVersionId, raw.id);
    assert.equal(repaired.rowCount, 400);
    const repairJob = detail.jobs.find((j: { type: string }) => j.type === "REPAIR");
    assert.deepEqual(repairJob.result.before.rows, 403);

    const download = await fetch(`${API}/datasets/${datasetId}/versions/${raw.id}/download`, { headers: { Cookie: owner.c.cookie } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), CSV, "raw upload is preserved byte-for-byte");
    const report = await owner.c.get(`/datasets/${datasetId}/versions/${raw.id}/report`);
    assert.match(report.body, /Dataset Quality Report/);
  });

  test("analysis operations produce downloadable artifacts in the library", async () => {
    let detail = (await owner.c.get(`/datasets/${datasetId}`)).body;
    const raw = detail.versions.find((v: { kind: string }) => v.kind === "RAW");
    const profile = detail.jobs.find(
      (j: { type: string; status: string; datasetVersionId: string }) =>
        j.type === "PROFILE" && j.status === "SUCCEEDED" && j.datasetVersionId === raw.id,
    );
    const kinds: Record<string, string> = profile.result.columnKinds;
    assert.ok(kinds && Object.keys(kinds).length > 0, "profile exposes columnKinds");
    const numeric = Object.keys(kinds).filter((c) => kinds[c] === "numeric");
    assert.ok(numeric.length >= 2, JSON.stringify(kinds));

    const ops = `/datasets/${datasetId}/versions/${raw.id}/operations`;
    const viz = await owner.c.post(ops, {
      operation: "VISUALIZE",
      params: { charts: [{ chartType: "histogram", x: numeric[0] }, { chartType: "scatter", x: numeric[0], y: numeric[1] }], formats: ["png", "svg"] },
    });
    assert.equal(viz.status, 201, JSON.stringify(viz.body));
    const bad = await owner.c.post(ops, { operation: "VISUALIZE", params: { charts: [{ chartType: "histogram", x: "no_such_column" }] } });
    const train = await owner.c.post(ops, {
      operation: "TRAIN",
      params: { task: "classification", target: "churned", algorithms: ["logistic_regression", "random_forest"], testSize: 0.25 },
    });
    assert.equal(train.status, 201, JSON.stringify(train.body));
    detail = await waitForJobs(owner.c, datasetId);
    const job = (id: string) => detail.jobs.find((j: { id: string }) => j.id === id);

    assert.equal(job(viz.body.id).status, "SUCCEEDED", job(viz.body.id).errorMessage);
    assert.equal(job(bad.body.id).status, "FAILED");
    assert.match(job(bad.body.id).errorMessage, /no_such_column/);
    const trained = job(train.body.id);
    assert.equal(trained.status, "SUCCEEDED", trained.errorMessage);
    assert.equal(trained.result.leaderboard.length, 2);
    assert.ok(trained.result.best.algorithm);

    const charts = (await owner.c.get(`/artifacts?jobId=${viz.body.id}`)).body.items;
    assert.ok(charts.some((a: { contentType: string }) => a.contentType === "image/png"));
    assert.ok(charts.some((a: { contentType: string }) => a.contentType === "image/svg+xml"));
    const png = charts.find((a: { previewable: boolean }) => a.previewable);
    const preview = await fetch(`${API}/artifacts/${png.id}/preview`, { headers: { Cookie: owner.c.cookie } });
    assert.equal(preview.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await preview.arrayBuffer()).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

    const models = (await owner.c.get(`/artifacts?jobId=${train.body.id}&kind=MODEL`)).body.items;
    assert.equal(models.length, 1);
    assert.match(models[0].filename, /\.joblib$/);

    const zip = await fetch(`${API}/artifacts/archive?jobId=${viz.body.id}`, { headers: { Cookie: owner.c.cookie } });
    assert.equal(zip.status, 200);
    assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), "PK");

    // Another organisation can neither list nor fetch these files.
    const outsider = await signUp("outsider");
    assert.equal((await outsider.c.get("/artifacts")).body.items.length, 0);
    const stolen = await fetch(`${API}/artifacts/${png.id}/download`, { headers: { Cookie: outsider.c.cookie } });
    assert.equal(stolen.status, 404);
  });

  test("files are encrypted at rest", async () => {
    const version = await prisma.datasetVersion.findFirstOrThrow({ where: { datasetId, kind: "RAW" } });
    const dir = resolve(__dirname, "../../..", process.env.STORAGE_DIR ?? "./storage");
    const stored = readFileSync(resolve(dir, version.objectKey!));
    assert.equal(stored.includes(Buffer.from("customer_id")), false);
  });

  test("tenants cannot see each other's data", async () => {
    const other = await signUp("intruder");
    assert.equal((await other.c.get(`/datasets/${datasetId}`)).status, 404);
    assert.equal((await other.c.get("/datasets")).body.length, 0);
    const res = await other.c.post("/auth/switch-organization", { organizationId: owner.me.activeOrganization.id });
    assert.equal(res.status, 404);
  });

  test("suspending an organisation blocks access", async () => {
    const orgId = owner.me.activeOrganization.id;
    await admin.c.post(`/admin/organizations/${orgId}/suspend`, { reason: "abuse review" });
    const res = await owner.c.get("/datasets");
    assert.equal(res.body.code, "ORG_SUSPENDED");
    await admin.c.post(`/admin/organizations/${orgId}/reactivate`, { reason: "review complete" });
    assert.equal((await owner.c.get("/datasets")).status, 200);
  });

  test("suspending a user revokes their sessions", async () => {
    const victim = await signUp("suspended");
    assert.equal((await victim.c.get("/auth/me")).status, 200);
    await admin.c.post(`/admin/users/${victim.me.user.id}/suspend`, { reason: "policy breach" });
    assert.equal((await victim.c.get("/auth/me")).status, 401);
    const login = await victim.c.post("/auth/login", { email: victim.email, password: PASSWORD });
    assert.equal(login.body.code, "ACCOUNT_SUSPENDED");
  });

  test("Paystack webhooks reject bad signatures", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "x" } });
    const sig = createHmac("sha512", "not-the-key").update(body).digest("hex");
    const res = await fetch(`${API}/billing/webhooks/paystack`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-paystack-signature": sig },
      body,
    });
    assert.equal(res.status, 401);
  });

  test("every admin action is audited", async () => {
    const events = await admin.c.get(`/admin/audit?organizationId=${owner.me.activeOrganization.id}`);
    const actions = events.body.map((e: { action: string }) => e.action);
    for (const a of ["trial.started", "admin.trial_ended", "admin.subscription_activated", "admin.organization_suspended"]) {
      assert.ok(actions.includes(a), `missing ${a}`);
    }
  });
});
