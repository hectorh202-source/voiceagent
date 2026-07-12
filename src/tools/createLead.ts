import type { Request, Response } from "express";
import { z } from "zod";
import { lookupCustomerByPhone, createCustomer } from "../servicetitan/customers";
import { createLead as createServiceTitanLead } from "../servicetitan/leads";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError, describeError } from "../servicetitan/httpClient";
import { getAgentTimezone, getDashboardBaseUrl } from "../settings/store";
import { formatPhoneNumber } from "../lib/format";

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
  isEmergency: booleanish.optional().default(false),
  // Rides along so the /calls/:conversationId dashboard page can correlate
  // this lead with the ElevenLabs post-call webhook data for the same call.
  conversationId: z.string().optional(),
});

// Builds the text that becomes the ServiceTitan Lead's `summary` field —
// ServiceTitan carries this over into the Job's Summary field when staff
// convert the lead, so this is effectively the Job Summary too. Structured
// as labeled lines (date, phone, address, a link back to this call's
// detail page) rather than one terse sentence, so staff reviewing/
// converting the lead get the full call context without digging through
// ElevenLabs' own dashboard.
function buildLeadSummary(
  businessId: number,
  input: {
    issueDescription: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    email?: string | null;
    preferredTiming?: string;
    isEmergency: boolean;
    conversationId?: string;
  },
): string {
  const address = `${input.street}, ${input.city}, ${input.state} ${input.zip}`;
  const now = new Date().toLocaleString("en-US", { timeZone: getAgentTimezone(businessId) });

  const narrative = `${input.issueDescription} at ${address}.${
    input.preferredTiming ? ` Preferred timing: ${input.preferredTiming}.` : ""
  }${input.isEmergency ? " Customer indicated this is an emergency." : ""}`;

  // Only populated when an existing ServiceTitan customer already has an
  // email on file (see lookupCustomerByPhone) — we never ask the caller for
  // one during the call, so a new customer simply won't have this line.
  const emailLine = input.email ? `\n\n- Email: ${input.email}` : "";

  // ServiceTitan's summary field doesn't auto-linkify plain URLs, so this
  // needs to actually be an anchor tag to render as clickable — a bare URL
  // just shows as inert text.
  const callDetailsLine = input.conversationId
    ? (() => {
        const url = `${getDashboardBaseUrl(businessId)}/b/${businessId}/calls/${input.conversationId}`;
        return `\n\n- Call Details: <a href="${url}">${url}</a>`;
      })()
    : "";

  return (
    `- Date: ${now}\n\n` +
    `${narrative}\n\n` +
    `- Phone: ${formatPhoneNumber(input.phone)}\n\n` +
    `- Address: ${address}` +
    emailLine +
    callDetailsLine +
    `\n\n- Call Taker: AI Agent`
  );
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
  const { phone, name, street, city, state, zip, issueDescription, preferredTiming, isEmergency, conversationId } =
    parsed.data;

  try {
    const existing = await lookupCustomerByPhone(business.id, phone);
    let customerId = existing.customerId;
    let locationId: string | undefined = existing.locationId ?? undefined;

    if (!customerId) {
      const created = await createCustomer(business.id, { name, phone, address: { street, city, state, zip } });
      customerId = created.customerId;
      locationId = created.locationId;
    }

    const summary = buildLeadSummary(business.id, {
      issueDescription,
      street,
      city,
      state,
      zip,
      phone,
      email: existing.email,
      preferredTiming,
      isEmergency,
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
      response,
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
