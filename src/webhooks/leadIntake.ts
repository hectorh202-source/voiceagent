import type { Request, Response } from "express";
import { leadIntakeSchema } from "../api/schemas";
import { insertInboundLead } from "../db/inboundLeads";

// Generic intake for the two lead sources that don't need their own
// integration (a business's website contact form or chat widget POSTs
// here directly — no OAuth, no per-vendor payload mapping). Facebook/Google
// ads leads, once built, write to inbound_leads directly from their own
// ingestion modules rather than through this endpoint.
export async function handleLeadIntake(req: Request, res: Response): Promise<void> {
  const { business } = req;
  if (!business) {
    res.status(404).end();
    return;
  }

  const parsed = leadIntakeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { source, name, phone, email, message, externalId } = parsed.data;
  insertInboundLead({
    businessId: business.id,
    source,
    externalId,
    name,
    phone,
    email,
    message,
    rawPayloadJson: JSON.stringify(req.body),
  });

  res.status(201).json({ success: true });
}
