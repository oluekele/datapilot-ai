import { smtpFromEnv } from "./mail/smtp-config";
import { resolve } from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const production = process.env.NODE_ENV === "production";
  const repoRoot = resolve(__dirname, "../../..");
  const encryptionKey = Buffer.from(required("STORAGE_ENCRYPTION_KEY"), "base64");
  if (encryptionKey.length !== 32) {
    throw new Error("STORAGE_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }
  const smtp = smtpFromEnv();
  const brevoApiKey = process.env.BREVO_API_KEY?.trim() || null;

  return {
    production,
    webOrigins: (process.env.WEB_ORIGIN ?? "http://localhost:3100")
      .split(",")
      // Browsers send Origin without a trailing slash, so "https://x.app/" must match too.
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    // The API's own public URL (Render sets RENDER_EXTERNAL_URL), used by the docs page.
    apiPublicOrigin: (process.env.API_PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? "").trim().replace(/\/+$/, ""),
    get publicWebUrl(): string {
      return process.env.PUBLIC_WEB_URL ?? this.webOrigins[0];
    },
    // Hosting platforms (Render, Railway, ...) provide PORT; API_PORT wins locally.
    port: int("API_PORT", int("PORT", 4000)),
    // Locally only this machine may connect; in production the platform's
    // router must reach the process, so listen on all interfaces.
    host: process.env.API_HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
    // Swagger UI at /api/docs: on in development, opt-in for production.
    docsEnabled: process.env.API_DOCS ? process.env.API_DOCS === "true" : !production,
    session: {
      cookieName: "dp_session",
      idleDays: int("SESSION_IDLE_DAYS", 7),
      absoluteDays: int("SESSION_ABSOLUTE_DAYS", 30),
      stepUpMinutes: 15,
    },
    lockout: { maxFailures: 5, minutes: 15 },
    mail: {
      smtp,
      // HTTPS email API; used instead of SMTP when set. Hosts such as Render's
      // free plan block outbound SMTP ports.
      brevoApiKey,
      from: process.env.MAIL_FROM ?? "DataPilot <no-reply@localhost>",
      // Return password-reset/invitation links in API responses so local
      // development works without a mail provider. Never in production.
      exposeDevLinks: !production && !smtp && !brevoApiKey,
    },
    storage: {
      dir: resolve(repoRoot, process.env.STORAGE_DIR ?? "./storage"),
      encryptionKey,
      hardMaxFileMb: 25,
    },
    worker: {
      python: resolve(repoRoot, process.env.WORKER_PYTHON ?? ".venv/bin/python"),
      pythonPath: resolve(repoRoot, "src"),
      concurrency: int("WORKER_CONCURRENCY", 2),
      timeoutMs: int("WORKER_TIMEOUT_SECONDS", 180) * 1000,
      // Model training can legitimately take longer than other operations.
      trainTimeoutMs: int("WORKER_TRAIN_TIMEOUT_SECONDS", 900) * 1000,
      pollMs: 1500,
      enabled: process.env.WORKER_ENABLED !== "false",
    },
    billing: {
      paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || null,
      graceDays: int("BILLING_GRACE_DAYS", 3),
    },
    // Every new account gets this many free-trial days at sign-up
    // (one-time per user and per organisation). 0 disables it.
    autoTrialDays: int("TRIAL_DAYS", 14),
    trialLimits: {
      maxDatasets: 5,
      maxJobsPerMonth: 50,
      maxFileMb: 10,
      maxMembers: 3,
    },
  };
}
