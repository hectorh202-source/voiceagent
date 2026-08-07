import type { Request, Response } from "express";
import { z } from "zod";
import { lookupCustomerByPhone, createCustomer } from "../servicetitan/customers";
import { createJob as createServiceTitanJob } from "../servicetitan/jobs";
import { checkAvailability } from "../servicetitan/capacity";
import { buildLeadSummary, buildInitialNarrative } from "../servicetitan/leadSummary";
import { runCreateLeadFlow, booleanish, type CreateLeadFlowInput } from "./createLead";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError, describeError } from "../servicetitan/httpClient";
import { resolveJobTypeOverrides } from "../servicetitan/jobTypes";

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

// Which of the four paths the flow actually took, so both callers (the HTTP
// handler below and the chat engine in src/chat/*) can log/render accordingly
// without re-deriving it:
//   emergency_lead — an emergency with no real near-term slot found; fell
//                    back to the proven Lead path
//   emergency_job  — an emergency that found and booked a real near-term
//                    slot (including on-call capacity, if ServiceTitan's
//                    Adaptive Capacity is configured to surface it)
//   no_slot        — book_job reached without a selected appointment time
//   job            — a real ServiceTitan Job was created (non-emergency)
export type BookJobOutcome = "emergency_lead" | "emergency_job" | "no_slot" | "job";

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
// How far out to look for a real near-term slot on an emergency call — a
// deliberately short window (a genuine emergency means "as soon as
// possible," not "sometime in the next two weeks," which is capacity.ts's
// own MAX_RANGE_DAYS for the normal check_availability path).
const EMERGENCY_WINDOW_HOURS = 24;

// Looks for a real bookable slot in the next EMERGENCY_WINDOW_HOURS —
// including on-call capacity, if ServiceTitan's Adaptive Capacity is
// configured to surface it (see docs/servicetitan-integration.md) — so an
// emergency call can actually be booked when real capacity genuinely
// exists, instead of always falling back to a Lead. Deliberately done here,
// server-side, rather than trusted to the agent's own multi-turn
// check_availability -> book_job conversation flow: that's exactly the
// reliability gap a real past incident (the Emergency Dispatch transfer
// failure) already showed isn't safe enough for something this urgent. A
// failed capacity check (ServiceTitan error, misconfiguration) is treated
// the same as "no slot found" — never thrown, always falls through to the
// existing Lead safety net below.
async function findEmergencySlot(
  businessId: number,
  serviceCategory: string | undefined,
): Promise<{ start: string; end: string } | null> {
  try {
    const overrides = await resolveJobTypeOverrides(businessId, serviceCategory);
    const now = new Date();
    const windowEnd = new Date(now.getTime() + EMERGENCY_WINDOW_HOURS * 60 * 60 * 1000);
    const result = await checkAvailability(businessId, now.toISOString(), windowEnd.toISOString(), overrides);
    const soonest = result.slots[0];
    return soonest ? { start: soonest.start, end: soonest.end } : null;
  } catch (error) {
    console.error("findEmergencySlot: capacity check failed, falling back to the Lead safety net:", error);
    return null;
  }
}

export async function runBookJobFlow(businessId: number, input: BookJobFlowInput): Promise<BookJobFlowResult> {
  let selectedStart = input.selectedStart;
  let selectedEnd = input.selectedEnd;

  if (input.isEmergency) {
    const slot = await findEmergencySlot(businessId, input.serviceCategory);
    if (slot) {
      // Real near-term capacity exists — fall through to the same booking
      // logic below as any other job, just with a server-found slot instead
      // of an agent-selected one.
      selectedStart = slot.start;
      selectedEnd = slot.end;
    } else {
      // No real near-term slot found (or the capacity check itself failed)
      // — fall back to the exact same proven Lead path create_lead uses,
      // same safety net as before this change.
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
  }

  if (!selectedStart || !selectedEnd) {
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

  const { businessUnitId, jobTypeId } = await resolveJobTypeOverrides(businessId, input.serviceCategory);
  const jobResult = await createServiceTitanJob(businessId, {
    customerId,
    locationId,
    summary,
    appointmentStart: selectedStart,
    appointmentEnd: selectedEnd,
    businessUnitId,
    jobTypeId,
  });

  return {
    outcome: input.isEmergency ? "emergency_job" : "job",
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

    // An emergency that fell back to the Lead safety net (outcome
    // "emergency_lead") actually created a Lead, so it's logged as
    // create_lead (not book_job) — it needs to be found by
    // findCreateLeadLogByConversationId (the dashboard/post-call-rebuild
    // code), not the book_job finder, which is meant to mean "an actual Job
    // exists." An emergency that found and booked a real slot (outcome
    // "emergency_job") did create a real Job, so it correctly falls through
    // to the "book_job" branch below like any other booked job.
    // email/equipmentAge ride along in the logged response only so the
    // post-call webhook can rebuild the summary with the real AI call
    // summary once it's available.
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
