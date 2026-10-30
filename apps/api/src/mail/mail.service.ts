import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Transporter } from "nodemailer";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";
import { createSmtpTransport } from "./smtp-config";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

/** Splits `"Name <addr@x>"` or `addr@x` into Brevo's sender shape. */
function parseAddress(value: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { email: value.trim() };
  const name = match[1].replace(/^"|"$/g, "");
  return name ? { email: match[2].trim(), name } : { email: match[2].trim() };
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly brevoApiKey: string | null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const smtp = config.mail.smtp;
    this.brevoApiKey = config.mail.brevoApiKey;
    this.transport = !this.brevoApiKey && smtp ? createSmtpTransport(smtp) : null;
    // Say which mode is active so a misconfiguration is obvious at startup.
    // Never log the password or API key.
    this.logger.log(
      this.brevoApiKey
        ? `Email delivery via Brevo API as ${config.mail.from}`
        : smtp
          ? `Email delivery via ${smtp.host}:${smtp.port} as ${smtp.user ?? "(no login)"}`
          : "Email delivery disabled (no BREVO_API_KEY/SMTP_HOST/SMTP_URL); links are returned in API responses",
    );
  }

  link(path: string): string {
    return new URL(path, this.config.publicWebUrl).toString();
  }

  /**
   * Sends a transactional email. Without a mail provider (development only)
   * the message is not sent; callers return the link to the developer instead.
   * Links are never logged because they carry bearer tokens.
   */
  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.brevoApiKey && !this.transport) {
      this.logger.log(`Email "${subject}" not sent (no mail provider configured).`);
      return;
    }
    try {
      if (this.brevoApiKey) await this.sendBrevo(to, subject, text);
      else await this.transport!.sendMail({ from: this.config.mail.from, to, subject, text });
    } catch (error) {
      // A mail outage must not fail the request (e.g. leave a half-finished
      // registration); the user can ask for the email again.
      this.logger.error(`Email "${subject}" could not be sent: ${(error as Error).message}`);
    }
  }

  private async sendBrevo(to: string, subject: string, text: string): Promise<void> {
    const response = await fetch(BREVO_URL, {
      method: "POST",
      headers: { "api-key": this.brevoApiKey!, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: parseAddress(this.config.mail.from),
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Brevo responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  }
}
