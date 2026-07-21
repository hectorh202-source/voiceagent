import type { Request, Response } from "express";
import { catchAllLeadSchema } from "../api/schemas";
import { insertInboundLead } from "../db/inboundLeads";
import { logToolCall } from "../db/callLog";

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

  // Notification (if enabled — see General Settings -> Operational) fires
  // centrally from insertInboundLead itself, same as every other Leads-inbox
  // source; nothing to wire up here.
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

  const response = { success: true, confirmationMessage: "Got it — someone from our team will follow up with you." };
  logToolCall({ businessId: business.id, toolName: "create_potential_lead", phone, request: parsed.data, response, success: true });
  res.json(response);
}
