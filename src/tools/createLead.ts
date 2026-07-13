import type { Request, Response } from "express";
import { z } from "zod";
import { lookupCustomerByPhone, createCustomer } from "../servicetitan/customers";
import { createLead as createServiceTitanLead } from "../servicetitan/leads";
import { buildLeadSummary, buildInitialNarrative } from "../servicetitan/leadSummary";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError, describeError } from "../servicetitan/httpClient";

// ElevenLabs' tool-calling occasionally sends boolean-typed fields as the
// strings "true"/"false" rather than a JSON boolean — accept both forms.
const booleanish = z.preprocess((value) => {
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return value;
}, z.boolean());

const bodySchema = z.object({
  phone: z.string().min(4),
  name: z.string().min(1),
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  issueDescription: z.string().min(1),
  preferredTiming: z.string().optional(),
  // Freeform (e.g. "3 years", "about 3") rather than a bare number — the
  // agent asks this contextually (HVAC/AC calls), so a new customer or an
  // unrelated issue simply won't have it.
  equipmentAge: z.string().optional(),
  isEmergency: booleanish.optional().default(false),
  // Rides along so the /calls/:conversationId dashboard page can correlate
  // this lead with the ElevenLabs post-call webhook data for the same call.
  conversationId: z.string().optional(),
});

export async function handleCreateLead(req: Request, res: Response): Promise<void> {
  const business = req.business;
  if (!business) {
    res.status(404).end();
    return;
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMessage = JSON.stringify(parsed.error.flatten());
    logToolCall({ businessId: business.id, toolName: "create_lead", request: req.body, success: false, errorMessage });
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const {
    phone,
    name,
    street,
    city,
    state,
    zip,
    issueDescription,
    preferredTiming,
    equipmentAge,
    isEmergency,
    conversationId,
  } = parsed.data;

  try {
    const existing = await lookupCustomerByPhone(business.id, phone);
    let customerId = existing.customerId;
    let locationId: string | undefined = existing.locationId ?? undefined;

    if (!customerId) {
      const created = await createCustomer(business.id, { name, phone, address: { street, city, state, zip } });
      customerId = created.customerId;
      locationId = created.locationId;
    }

    // The agent's own answer this call wins if given — more likely current
    // than whatever might be on file, since equipment gets replaced. Falls
    // back to the ServiceTitan on-file value (e.g. a non-HVAC call, or the
    // agent didn't ask) when there's no fresh answer.
    const resolvedEquipmentAge = equipmentAge ?? existing.equipmentAge;

    const narrative = buildInitialNarrative({ issueDescription, street, city, state, zip, preferredTiming, isEmergency });
    const summary = buildLeadSummary(business.id, {
      narrative,
      street,
      city,
      state,
      zip,
      phone,
      email: existing.email,
      equipmentAge: resolvedEquipmentAge,
      conversationId,
    });

    const leadResult = await createServiceTitanLead(business.id, { customerId, locationId, summary, isEmergency });

    const response = {
      success: leadResult.success,
      leadId: leadResult.leadId,
      confirmationMessage: leadResult.success
        ? "A team member will confirm your appointment shortly."
        : "We had trouble saving your request, but a team member will follow up with you directly.",
    };

    logToolCall({
      businessId: business.id,
      toolName: "create_lead",
      phone,
      request: parsed.data,
      // email and equipmentAge ride along in the logged response only (not
      // sent back to ElevenLabs) so the post-call webhook can rebuild this
      // same summary with the real AI call summary once it's available —
      // see webhooks/postCall.ts.
      response: { ...response, email: existing.email, equipmentAge: resolvedEquipmentAge },
      success: leadResult.success,
    });
    res.json(response);
  } catch (error) {
    const status = error instanceof ServiceTitanNotConfiguredError ? 503 : 502;
    const message = error instanceof ServiceTitanNotConfiguredError ? error.message : describeError(error);
    logToolCall({
      businessId: business.id,
      toolName: "create_lead",
      phone,
      request: parsed.data,
      success: false,
      errorMessage: message,
    });
    res.status(status).json({
      success: false,
      leadId: null,
      confirmationMessage: "We had trouble saving your request, but a team member will follow up with you directly.",
    });
  }
}
