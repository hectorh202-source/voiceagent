import type { Request, Response } from "express";
import { z } from "zod";
import { lookupCustomerByPhone, createCustomer } from "../servicetitan/customers";
import { createLead as createServiceTitanLead } from "../servicetitan/leads";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError } from "../servicetitan/httpClient";

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
  address: z.string().min(1),
  issueDescription: z.string().min(1),
  preferredTiming: z.string().optional(),
  isEmergency: booleanish.optional().default(false),
});

export async function handleCreateLead(req: Request, res: Response): Promise<void> {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMessage = JSON.stringify(parsed.error.flatten());
    logToolCall({ toolName: "create_lead", request: req.body, success: false, errorMessage });
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { phone, name, address, issueDescription, preferredTiming, isEmergency } = parsed.data;

  try {
    const existing = await lookupCustomerByPhone(phone);
    let customerId = existing.customerId;
    let locationId: string | undefined;

    if (!customerId) {
      const created = await createCustomer({ name, phone, address: { street: address } });
      customerId = created.customerId;
      locationId = created.locationId;
    }

    const summary = `${issueDescription}${
      preferredTiming ? ` — preferred timing: ${preferredTiming}` : ""
    } (via AI receptionist)`;

    const leadResult = await createServiceTitanLead({ customerId, locationId, summary, isEmergency });

    const response = {
      success: leadResult.success,
      leadId: leadResult.leadId,
      confirmationMessage: leadResult.success
        ? "A team member will confirm your appointment shortly."
        : "We had trouble saving your request, but a team member will follow up with you directly.",
    };

    logToolCall({ toolName: "create_lead", phone, request: parsed.data, response, success: leadResult.success });
    res.json(response);
  } catch (error) {
    const status = error instanceof ServiceTitanNotConfiguredError ? 503 : 502;
    const message = error instanceof Error ? error.message : "Unknown error";
    logToolCall({ toolName: "create_lead", phone, request: parsed.data, success: false, errorMessage: message });
    res.status(status).json({
      success: false,
      leadId: null,
      confirmationMessage: "We had trouble saving your request, but a team member will follow up with you directly.",
    });
  }
}
