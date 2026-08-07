import type { Request, Response } from "express";
import { z } from "zod";
import { lookupCustomerByPhone, createCustomer } from "../servicetitan/customers";
import { createJob as createServiceTitanJob } from "../servicetitan/jobs";
import { buildLeadSummary, buildInitialNarrative } from "../servicetitan/leadSummary";
import { runCreateLeadFlow, booleanish, type CreateLeadFlowInput } from "./createLead";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError, describeError } from "../servicetitan/httpClient";
import { resolveServiceCategory } from "../settings/store";

const bodySchema = z.object({
  phone: z.string().min(4),
  name: z.string().min(1),
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  issueDescription: z.string().min(1),
  preferredTiming: z.string().optional(),
  equipmentAge: z.string().optional(),
  isEmergency: booleanish.optional().default(false),
  conversationId: z.string().optional(),
  // Not required at the schema level — an emergency call skips booking
  // entirely (see the safety net below) and may never have gotten this far
  // in the conversation, so this can't be a hard validation requirement.
  // Only enforced once we know we're actually about to book.
  selectedStart: z.string().optional(),
  selectedEnd: z.string().optional(),
  serviceCategory: z.string().optional(),
});

export interface BookJobFlowInput extends CreateLeadFlowInput {
  selectedStart?: string;
  selectedEnd?: string;
}

// Which of the three paths the flow actually took, so both callers (the HTTP
// handler below and the chat engine in src/chat/*) can log/render accordingly
// without re-deriving it:
//   emergency_lead — an emergency short-circuited to the proven Lead path
//   no_slot        — book_job reached without a selected appointment time
//   job            — a real ServiceTitan Job was created
export type BookJobOutcome = "emergency_lead" | "no_slot" | "job";

export interface BookJobFlowResult {
  outcome: BookJobOutcome;
  success: boolean;
  jobId: string | null;
  leadId: string | null;
  email: string | null;
  equipmentAge: string | null;
  confirmationMessage: string;
}

// The actual booking logic, factored out (mirroring createLead.ts's
// runCreateLeadFlow) so the ElevenLabs HTTP handler and the website chat
// engine share one implementation and one set of guardrails. Throws on
// ServiceTitan errors (ServiceTitanNotConfiguredError / request failures) —
// callers own the try/catch and their own logging/HTTP shaping.
export async function runBookJobFlow(businessId: number, input: BookJobFlowInput): Promise<BookJobFlowResult> {
  // Safety net, enforced here rather than trusted to the system prompt alone:
  // an emergency never gets auto-booked, regardless of which tool the agent
  // actually called. Falls back to the exact same proven Lead path
  // create_lead uses. We already found once (Emergency Dispatch) that relying
  // on the agent to route correctly on its own isn't reliable enough for
  // something this consequential.
  if (input.isEmergency) {
    const result = await runCreateLeadFlow(businessId, input);
    return {
      outcome: "emergency_lead",
      success: result.success,
      jobId: null,
      leadId: result.leadId,
      email: result.email,
      equipmentAge: result.equipmentAge,
      confirmationMessage: result.success
        ? "A team member will confirm your appointment shortly."
        : "We had trouble saving your request, but a team member will follow up with you directly.",
    };
  }

  if (!input.selectedStart || !input.selectedEnd) {
    return {
      outcome: "no_slot",
      success: false,
      jobId: null,
      leadId: null,
      email: null,
      equipmentAge: null,
      confirmationMessage: "We had trouble booking that time — a team member will follow up to schedule.",
    };
  }

  const existing = await lookupCustomerByPhone(businessId, input.phone);
  let customerId = existing.customerId;
  let locationId = existing.locationId;

  if (!customerId) {
    const created = await createCustomer(businessId, {
      name: input.name,
      phone: input.phone,
      address: { street: input.street, city: input.city, state: input.state, zip: input.zip },
    });
    customerId = created.customerId;
    locationId = created.locationId;
  }

  const resolvedEquipmentAge = input.equipmentAge ?? existing.equipmentAge;
  const narrative = buildInitialNarrative({
    issueDescription: input.issueDescription,
    street: input.street,
    city: input.city,
    state: input.state,
    zip: input.zip,
    preferredTiming: input.preferredTiming,
    isEmergency: false,
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

  const { businessUnitId, jobTypeId } = resolveServiceCategory(businessId, input.serviceCategory);
  const jobResult = await createServiceTitanJob(businessId, {
    customerId,
    locationId,
    summary,
    appointmentStart: input.selectedStart,
    appointmentEnd: input.selectedEnd,
    businessUnitId,
    jobTypeId,
  });

  return {
    outcome: "job",
    success: jobResult.success,
    jobId: jobResult.jobId,
    leadId: null,
    email: existing.email,
    equipmentAge: resolvedEquipmentAge,
    confirmationMessage: jobResult.success
      ? "You're all set — we've booked your appointment."
      : "We had trouble booking that time — a team member will follow up to schedule.",
  };
}

export async function handleBookJob(req: Request, res: Response): Promise<void> {
  const business = req.business;
  if (!business) {
    res.status(404).end();
    return;
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMessage = JSON.stringify(parsed.error.flatten());
    logToolCall({ businessId: business.id, toolName: "book_job", request: req.body, success: false, errorMessage });
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { phone } = parsed.data;

  try {
    const result = await runBookJobFlow(business.id, parsed.data);

    if (result.outcome === "no_slot") {
      logToolCall({
        businessId: business.id,
        toolName: "book_job",
        phone,
        request: parsed.data,
        success: false,
        errorMessage: "book_job called without a selected appointment time",
      });
      res.status(400).json({
        success: false,
        jobId: null,
        confirmationMessage: result.confirmationMessage,
      });
      return;
    }

    const response = {
      success: result.success,
      jobId: result.jobId,
      leadId: result.leadId,
      confirmationMessage: result.confirmationMessage,
    };

    // An emergency actually created a Lead, so it's logged as create_lead (not
    // book_job) — it needs to be found by findCreateLeadLogByConversationId
    // (the dashboard/post-call-rebuild code), not the book_job finder, which
    // is meant to mean "an actual Job exists." email/equipmentAge ride along
    // in the logged response only so the post-call webhook can rebuild the
    // summary with the real AI call summary once it's available.
    logToolCall({
      businessId: business.id,
      toolName: result.outcome === "emergency_lead" ? "create_lead" : "book_job",
      phone,
      request: parsed.data,
      response: { ...response, email: result.email, equipmentAge: result.equipmentAge },
      success: result.success,
    });
    res.json(response);
  } catch (error) {
    const status = error instanceof ServiceTitanNotConfiguredError ? 503 : 502;
    const message = error instanceof ServiceTitanNotConfiguredError ? error.message : describeError(error);
    logToolCall({
      businessId: business.id,
      toolName: "book_job",
      phone,
      request: parsed.data,
      success: false,
      errorMessage: message,
    });
    res.status(status).json({
      success: false,
      jobId: null,
      confirmationMessage: "We had trouble saving your request, but a team member will follow up with you directly.",
    });
  }
}
