import { createSmtpTransport, smtpFromEnv } from "../src/mail/smtp-config";

// Usage: npm run mail:test --workspace @datapilot/api -- you@example.com
// Checks the SMTP settings in .env by logging in and sending one email.
async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to) throw new Error("Pass the address to send the test email to.");
  const smtp = smtpFromEnv();
  if (!smtp) throw new Error("No SMTP settings found. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS in .env.");
  const from = process.env.MAIL_FROM ?? smtp.user ?? "no-reply@localhost";
  console.log(`Connecting to ${smtp.host}:${smtp.port} (${smtp.secure ? "TLS" : "STARTTLS"}) as ${smtp.user ?? "(no login)"}...`);
  const transport = createSmtpTransport(smtp);
  await transport.verify();
  console.log("Login OK. Sending...");
  const info = await transport.sendMail({
    from,
    to,
    subject: "DataPilot test email",
    text: "If you can read this, DataPilot can send verification emails.",
  });
  console.log(`Sent from ${from} to ${to}. Server reply: ${info.response}`);
  console.log("Check the inbox and the spam folder.");
}

main().catch((error: Error & { code?: string; responseCode?: number }) => {
  console.error(`Failed: ${error.message}`);
  if (error.code === "EAUTH") {
    console.error("The server rejected the username/password. For Gmail you must use an App Password, not your normal password.");
  } else if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED"].includes(error.code ?? "")) {
    console.error("Could not reach the mail server. Check SMTP_HOST/SMTP_PORT (587 with SMTP_SECURE=false, or 465 with SMTP_SECURE=true).");
  }
  process.exit(1);
});
