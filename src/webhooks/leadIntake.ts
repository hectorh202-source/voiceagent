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
    // Logged unconditionally on a validation failure (not just the error
    // itself) while this is still being verified against a real third-party
    // form tool — the exact keys/shape a given tool sends can't be assumed
    // (confirmed: Elementor keys fields by label, not a fixed name), so this
    // is the fastest way to see what actually arrived rather than guessing
    // again. Remove once the mapping for whatever tool is being onboarded is
    // confirmed working.
    console.log("Lead intake validation failed. Raw body:", JSON.stringify(req.body));
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

  // Deliberately 200, not the more conventional 201 for a created resource —
  // confirmed Elementor Pro Forms' Webhook action only treats a literal 200
  // as success and throws a "Webhook Error" for anything else (201, 204,
  // etc.), and compatibility with third-party form tools is this endpoint's
  // entire reason to exist.
  res.status(200).json({ success: true });
}
