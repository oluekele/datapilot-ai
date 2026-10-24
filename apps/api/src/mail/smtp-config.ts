import { createTransport, type Transporter } from "nodemailer";

export type SmtpConfig = {
  host: string;
  port: number;
  /** true = TLS from the start (port 465); false = STARTTLS upgrade (port 587). */
  secure: boolean;
  user: string | null;
  pass: string | null;
};

/**
 * Reads SMTP settings from the environment. Two equivalent styles:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE  (no escaping needed)
 *   SMTP_URL=smtps://user:password@host:465                  (special characters must be URL-encoded)
 * SMTP_HOST wins if both are set. Returns null when email delivery is not configured.
 */
export function smtpFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT || 587);
    if (!Number.isInteger(port)) throw new Error("SMTP_PORT must be a number");
    return {
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
      user: env.SMTP_USER || null,
      pass: env.SMTP_PASS || null,
    };
  }
  if (env.SMTP_URL) {
    const url = new URL(env.SMTP_URL);
    const secure = url.protocol === "smtps:";
    return {
      host: url.hostname,
      port: Number(url.port || (secure ? 465 : 587)),
      secure,
      user: url.username ? decodeURIComponent(url.username) : null,
      pass: url.password ? decodeURIComponent(url.password) : null,
    };
  }
  return null;
}

export function createSmtpTransport(smtp: SmtpConfig): Transporter {
  return createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
}
