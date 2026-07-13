import type { Request, Response } from "express";
import { z } from "zod";
import { lookupCustomerByPhone, createCustomer } from "../servicetitan/customers";
import { createLead as createServiceTitanLead } from "../servicetitan/leads";
import { buildLeadSummary, buildInitialNarrative } from "../servicetitan/leadSummary";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError, describeError } from "../servicetitan/httpClient";

// ElevenLabs' tool-calling occasionally sends boolean-typed fields as the
// strings "true"/"false" rather than a JSON boolean — accept both forms.
// Exported so tools/bookJob.ts's body schema can reuse it too.
export const booleanish = z.preprocess((value) => {
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

export interface CreateLeadFlowInput {
  phone: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  issueDescription: string;
  preferredTiming?: string;
  equipmentAge?: string;
  isEmergency: boolean;
  conversationId?: string;
}

export interface CreateLeadFlowResult {
  success: boolean;
  leadId: string | null;
  email: string | null;
  equipmentAge: string | null;
}

// The actual customer-lookup/summary/ServiceTitan-write logic, factored out
// so tools/bookJob.ts can reuse it exactly for its emergency safety net
// (isEmergency calls always get today's proven Lead path, regardless of
// which tool the agent invoked) without duplicating it.
export async function runCreateLeadFlow(businessId: number, input: CreateLeadFlowInput): Promise<CreateLeadFlowResult> {
  const existing = await lookupCustomerByPhone(businessId, input.phone);
  let customerId = existing.customerId;
  let locationId: string | undefined = existing.locationId ?? undefined;

  if (!customerId) {
    const created = await createCustomer(businessId, {
      name: input.name,
      phone: input.phone,
      address: { street: input.street, city: input.city, state: input.state, zip: input.zip },
    });
    customerId = created.customerId;
    locationId = created.locationId;
  }

  // The agent's own answer this call wins if given — more likely current
  // than whatever might be on file, since equipment gets replaced. Falls
  // back to the ServiceTitan on-file value (e.g. a non-HVAC call, or the
  // agent didn't ask) when there's no fresh answer.
  const resolvedEquipmentAge = input.equipmentAge ?? existing.equipmentAge;

  const narrative = buildInitialNarrative({
    issueDescription: input.issueDescription,
    street: input.street,
    city: input.city,
    state: input.state,
    zip: input.zip,
    preferredTiming: input.preferredTiming,
    isEmergency: input.isEmergency,
  });
  const summary = buildLeadSummary(businessId, {
    narrative,
    street: input.street,
    city: input.city,
    state: input.state,
    zip: input.zip,
    phone: input.phone,
    email: existing.email,
    equipmentAge: resolvedEquipmentAge,
    conversationId: input.conversationId,
  });

  const leadResult = await createServiceTitanLead(businessId, {
    customerId,
    locationId,
    summary,
    isEmergency: input.isEmergency,
  });

  return {
    success: leadResult.success,
    leadId: leadResult.leadId,
    email: existing.email,
    equipmentAge: resolvedEquipmentAge,
  };
}

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
  const { phone } = parsed.data;

  try {
    const result = await runCreateLeadFlow(business.id, parsed.data);

    const response = {
      success: result.success,
      leadId: result.leadId,
      confirmationMessage: result.success
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
      response: { ...response, email: result.email, equipmentAge: result.equipmentAge },
      success: result.success,
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
