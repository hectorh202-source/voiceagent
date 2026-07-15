import nodemailer from "nodemailer";
import { getSmtpConfig } from "./store";

// Not configured is a real, expected state (a fresh deploy has no SMTP
// settings yet) — callers decide what that means for their flow rather than
// this module throwing a generic error every time.
export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured. Add SMTP settings in Admin Settings first.");
    this.name = "EmailNotConfiguredError";
  }
}

function getTransport() {
  const config = getSmtpConfig();
  if (!config) throw new EmailNotConfiguredError();
  return {
    transport: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    }),
    from: `"${config.fromName}" <${config.fromAddress}>`,
  };
}

// A plain-text fallback alongside the HTML body — some corporate mail
// gateways/clients still prefer or require it, and it costs nothing to
// include.
function wrapEmailHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:32px 16px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e5ea;border-radius:12px;padding:32px;">
    <div style="font-weight:700;font-size:15px;color:#12151c;margin-bottom:24px;">Voice Agent Platform</div>
    <h1 style="font-size:18px;margin:0 0 16px;color:#1a1d23;">${title}</h1>
    ${bodyHtml}
  </div>
  <div style="max-width:480px;margin:16px auto 0;text-align:center;font-size:12px;color:#6b7280;">
    This is an automated message from Voice Agent Platform.
  </div>
</body>
</html>`;
}

export async function sendPasswordResetEmail(toEmail: string, resetUrl: string): Promise<void> {
  const { transport, from } = getTransport();
  const html = wrapEmailHtml(
    "Reset your password",
    `
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      We received a request to reset the password for your account. This link expires in 1 hour and can only be used once.
    </p>
    <a href="${resetUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#3b6ef6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Reset password</a>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;">
      If you didn't request this, you can safely ignore this email — your password won't be changed.
    </p>
    <p style="color:#9aa0ab;font-size:12px;word-break:break-all;">${resetUrl}</p>
    `,
  );
  const text = `Reset your password\n\nWe received a request to reset the password for your account. This link expires in 1 hour and can only be used once.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;

  await transport.sendMail({ from, to: toEmail, subject: "Reset your password", html, text });
}

export async function sendTestEmail(toEmail: string): Promise<void> {
  const { transport, from } = getTransport();
  const html = wrapEmailHtml(
    "Test email",
    `
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      This is a test message confirming your SMTP settings are configured correctly. If you're reading this, password reset emails will send successfully too.
    </p>
    `,
  );
  await transport.sendMail({
    from,
    to: toEmail,
    subject: "Voice Agent Platform — test email",
    html,
    text: "This is a test message confirming your SMTP settings are configured correctly.",
  });
}
