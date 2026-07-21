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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface WidgetLeadNotification {
  businessName: string;
  // "booked" when the widget booked a real appointment, "lead" when it
  // forwarded the visitor for staff to follow up. Anything else renders plainly.
  sourceDetail?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  message?: string;
  // Structured triage details the widget's assistant recorded (service type,
  // urgency, etc.). Rendered as extra rows above the free-text details.
  structuredFields?: { label: string; value: string }[];
  // Deep link into the Leads inbox for this business, when known.
  leadsUrl?: string;
}

// Sent to a business each time its chat widget produces a request. Best-effort:
// callers wrap this in try/catch so a mail failure never blocks recording the
// lead. Lead fields are visitor-supplied, so every one is HTML-escaped.
export async function sendWidgetLeadNotificationEmail(
  toEmails: string[],
  lead: WidgetLeadNotification,
  ccEmails: string[] = [],
): Promise<void> {
  const { transport, from } = getTransport();

  const booked = lead.sourceDetail === "booked";
  const heading = booked ? "New appointment booked" : "New lead from your website chat";
  // Contact fields first, then whatever structured fields the assistant
  // recorded, then the free-text details/transcript last.
  const rows: [string, string | undefined][] = [
    ["Name", lead.name],
    ["Phone", lead.phone],
    ["Email", lead.email],
    ["Address", lead.address],
    ...(lead.structuredFields ?? []).map(({ label, value }): [string, string | undefined] => [label, value]),
    ["Details", lead.message],
  ];
  const rowsHtml = rows
    .filter(([, value]) => value && value.trim())
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;">${label}</td><td style="padding:6px 0;color:#1a1d23;font-size:14px;">${escapeHtml(value!.trim())}</td></tr>`,
    )
    .join("");

  const linkHtml = lead.leadsUrl
    ? `<a href="${escapeHtml(lead.leadsUrl)}" style="display:inline-block;margin:16px 0 0;padding:12px 24px;background:#3b6ef6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">View in Leads inbox</a>`
    : "";

  const html = wrapEmailHtml(
    heading,
    `
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      ${booked ? "Your website chat assistant just booked an appointment" : "Your website chat assistant just captured a new lead"} for <strong>${escapeHtml(lead.businessName)}</strong>.
    </p>
    <table style="border-collapse:collapse;margin:8px 0;">${rowsHtml || `<tr><td style="color:#6b7280;font-size:13px;">No contact details were captured.</td></tr>`}</table>
    ${linkHtml}
    `,
  );

  const textLines = [
    heading,
    `Business: ${lead.businessName}`,
    ...rows.filter(([, v]) => v && v.trim()).map(([label, v]) => `${label}: ${v!.trim()}`),
    lead.leadsUrl ? `\nView in Leads inbox: ${lead.leadsUrl}` : "",
  ].filter(Boolean);

  await transport.sendMail({
    from,
    to: toEmails.join(", "),
    ...(ccEmails.length ? { cc: ccEmails.join(", ") } : {}),
    subject: booked ? `New appointment booked — ${lead.businessName}` : `New website lead — ${lead.businessName}`,
    html,
    text: textLines.join("\n"),
  });
}

export interface CatchAllLeadNotification {
  businessName: string;
  name?: string;
  phone?: string;
  email?: string;
  // Why the call didn't produce a real ServiceTitan Lead/Job — surfaced so
  // staff know what to do with this lead, not just that one exists.
  reason?: string;
  message?: string;
  leadsUrl?: string;
}

// Sent to a business each time its AI phone agent falls back to this
// catch-all instead of successfully creating a ServiceTitan Lead/Job — see
// tools/createPotentialLead.ts. Best-effort: callers wrap this in try/catch
// so a mail failure never blocks recording the lead. Fields are caller-
// supplied (via the LLM), so every one is HTML-escaped.
export async function sendCatchAllLeadNotificationEmail(
  toEmails: string[],
  lead: CatchAllLeadNotification,
  ccEmails: string[] = [],
): Promise<void> {
  const { transport, from } = getTransport();

  const heading = "New lead from your AI phone agent";
  const rows: [string, string | undefined][] = [
    ["Name", lead.name],
    ["Phone", lead.phone],
    ["Email", lead.email],
    ["Why no booking", lead.reason],
    ["Details", lead.message],
  ];
  const rowsHtml = rows
    .filter(([, value]) => value && value.trim())
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;">${label}</td><td style="padding:6px 0;color:#1a1d23;font-size:14px;">${escapeHtml(value!.trim())}</td></tr>`,
    )
    .join("");

  const linkHtml = lead.leadsUrl
    ? `<a href="${escapeHtml(lead.leadsUrl)}" style="display:inline-block;margin:16px 0 0;padding:12px 24px;background:#3b6ef6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">View in Leads inbox</a>`
    : "";

  const html = wrapEmailHtml(
    heading,
    `
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      A caller couldn't be booked into a job or turned into a ServiceTitan lead during a call with your AI phone agent for <strong>${escapeHtml(lead.businessName)}</strong> — here's what was captured.
    </p>
    <table style="border-collapse:collapse;margin:8px 0;">${rowsHtml || `<tr><td style="color:#6b7280;font-size:13px;">No contact details were captured.</td></tr>`}</table>
    ${linkHtml}
    `,
  );

  const textLines = [
    heading,
    `Business: ${lead.businessName}`,
    ...rows.filter(([, v]) => v && v.trim()).map(([label, v]) => `${label}: ${v!.trim()}`),
    lead.leadsUrl ? `\nView in Leads inbox: ${lead.leadsUrl}` : "",
  ].filter(Boolean);

  await transport.sendMail({
    from,
    to: toEmails.join(", "),
    ...(ccEmails.length ? { cc: ccEmails.join(", ") } : {}),
    subject: `New AI phone agent lead — ${lead.businessName}`,
    html,
    text: textLines.join("\n"),
  });
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
