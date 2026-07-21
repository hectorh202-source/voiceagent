import type { Request, Response } from "express";
import { catchAllLeadSchema } from "../api/schemas";
import { insertInboundLead } from "../db/inboundLeads";
import { logToolCall } from "../db/callLog";
import { isCatchAllLeadNotifyEnabled, getCatchAllLeadNotifyEmails, getCatchAllLeadNotifyCcEmails } from "../settings/store";
import { sendCatchAllLeadNotificationEmail } from "../settings/email";

// Fire-and-forget email alert, same reasoning as webhooks/leadIntake.ts's
// notifyWidgetLead — never awaited by the caller and swallows its own
// errors, since a missing SMTP config or a bad recipient must never delay
// or fail the tool's response back to ElevenLabs (the agent is still live
// on the call waiting for this).
function notifyCatchAllLead(
  businessId: number,
  businessName: string,
  leadsUrl: string,
  lead: { name?: string; phone?: string; email?: string; reason?: string; message?: string },
): void {
  if (!isCatchAllLeadNotifyEnabled(businessId)) return;
  const recipients = getCatchAllLeadNotifyEmails(businessId);
  const cc = getCatchAllLeadNotifyCcEmails(businessId);
  const to = recipients.length > 0 ? recipients : cc;
  const ccFinal = recipients.length > 0 ? cc : [];
  if (to.length === 0) return;

  sendCatchAllLeadNotificationEmail(to, { businessName, leadsUrl, ...lead }, ccFinal).catch((error) => {
    console.error("Catch-all lead notification email failed:", error instanceof Error ? error.message : error);
  });
}

// The AI phone agent's safety net — called instead of (or after a failed)
// create_lead/book_job, whenever a call can't produce a real ServiceTitan
// Lead/Job: missing required fields, a ServiceTitan error, the caller
// wasn't ready to commit, an issue this business doesn't handle, etc.
// Writes straight into this app's own Leads inbox (inbound_leads), not
// ServiceTitan — the whole point is capturing something rather than losing
// the caller's info outright when the main path doesn't work out.
export async function handleCreatePotentialLead(req: Request, res: Response): Promise<void> {
  const business = req.business;
  if (!business) {
    res.status(404).end();
    return;
  }

  const parsed = catchAllLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMessage = JSON.stringify(parsed.error.flatten());
    logToolCall({ businessId: business.id, toolName: "create_potential_lead", request: req.body, success: false, errorMessage });
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { name, phone, email, details, reason, conversationId } = parsed.data;

  insertInboundLead({
    businessId: business.id,
    source: "voice_agent",
    externalId: conversationId,
    name,
    phone,
    email,
    message: [details, reason ? `(${reason})` : undefined].filter(Boolean).join(" ") || undefined,
    rawPayloadJson: JSON.stringify(req.body),
  });

  const leadsUrl = `${req.protocol}://${req.get("host")}/app/${business.id}/leads`;
  notifyCatchAllLead(business.id, business.name, leadsUrl, { name, phone, email, reason, message: details });

  const response = { success: true, confirmationMessage: "Got it — someone from our team will follow up with you." };
  logToolCall({ businessId: business.id, toolName: "create_potential_lead", phone, request: parsed.data, response, success: true });
  res.json(response);
}
