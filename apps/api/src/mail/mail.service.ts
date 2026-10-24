import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Transporter } from "nodemailer";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";
import { createSmtpTransport } from "./smtp-config";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const smtp = config.mail.smtp;
    this.transport = smtp ? createSmtpTransport(smtp) : null;
    // Say which mode is active so a misconfiguration is obvious at startup.
    // Never log the password.
    this.logger.log(
      smtp
        ? `Email delivery via ${smtp.host}:${smtp.port} as ${smtp.user ?? "(no login)"}`
        : "Email delivery disabled (no SMTP_HOST/SMTP_URL); links are returned in API responses",
    );
  }

  link(path: string): string {
    return new URL(path, this.config.publicWebUrl).toString();
  }

  /**
   * Sends a transactional email. Without SMTP (development only) the message
   * is not sent; callers return the link to the developer instead. Links are
   * never logged because they carry bearer tokens.
   */
  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transport) {
      this.logger.log(`Email "${subject}" not sent (no SMTP_URL configured).`);
      return;
    }
    try {
      await this.transport.sendMail({ from: this.config.mail.from, to, subject, text });
    } catch (error) {
      // A mail outage must not fail the request (e.g. leave a half-finished
      // registration); the user can ask for the email again.
      this.logger.error(`Email "${subject}" could not be sent: ${(error as Error).message}`);
    }
  }
}
