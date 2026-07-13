import type { Request, Response } from "express";
import { z } from "zod";
import { lookupCustomerByPhone, createCustomer } from "../servicetitan/customers";
import { createJob as createServiceTitanJob } from "../servicetitan/jobs";
import { buildLeadSummary, buildInitialNarrative } from "../servicetitan/leadSummary";
import { runCreateLeadFlow, booleanish } from "./createLead";
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
  const { phone, isEmergency, selectedStart, selectedEnd } = parsed.data;

  try {
    // Safety net, enforced here rather than trusted to the system prompt
    // alone: an emergency never gets auto-booked, regardless of which tool
    // the agent actually called. Falls back to the exact same proven Lead
    // path create_lead uses. We already found once (Emergency Dispatch)
    // that relying on the agent to route correctly on its own isn't
    // reliable enough for something this consequential.
    if (isEmergency) {
      const result = await runCreateLeadFlow(business.id, parsed.data);
      const response = {
        success: result.success,
        jobId: null,
        leadId: result.leadId,
        confirmationMessage: result.success
          ? "A team member will confirm your appointment shortly."
          : "We had trouble saving your request, but a team member will follow up with you directly.",
      };
      // Logged as create_lead, not book_job — this branch actually created a
      // Lead, so it needs to be found by findCreateLeadLogByConversationId
      // (the dashboard/post-call-rebuild code), not the book_job finder,
      // which is meant to mean "an actual Job exists."
      logToolCall({
        businessId: business.id,
        toolName: "create_lead",
        phone,
        request: parsed.data,
        response: { ...response, email: result.email, equipmentAge: result.equipmentAge },
        success: result.success,
      });
      res.json(response);
      return;
    }

    if (!selectedStart || !selectedEnd) {
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
        confirmationMessage: "We had trouble booking that time — a team member will follow up to schedule.",
      });
      return;
    }

    const existing = await lookupCustomerByPhone(business.id, phone);
    let customerId = existing.customerId;
    let locationId = existing.locationId;

    if (!customerId) {
      const created = await createCustomer(business.id, {
        name: parsed.data.name,
        phone,
        address: { street: parsed.data.street, city: parsed.data.city, state: parsed.data.state, zip: parsed.data.zip },
      });
      customerId = created.customerId;
      locationId = created.locationId;
    }

    const resolvedEquipmentAge = parsed.data.equipmentAge ?? existing.equipmentAge;
    const narrative = buildInitialNarrative({
      issueDescription: parsed.data.issueDescription,
      street: parsed.data.street,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
      preferredTiming: parsed.data.preferredTiming,
      isEmergency: false,
    });
    const summary = buildLeadSummary(business.id, {
      narrative,
      street: parsed.data.street,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
      phone,
      email: existing.email,
      equipmentAge: resolvedEquipmentAge,
      conversationId: parsed.data.conversationId,
    });

    const { businessUnitId, jobTypeId } = resolveServiceCategory(business.id, parsed.data.serviceCategory);
    const jobResult = await createServiceTitanJob(business.id, {
      customerId,
      locationId,
      summary,
      appointmentStart: selectedStart,
      appointmentEnd: selectedEnd,
      businessUnitId,
      jobTypeId,
    });

    const response = {
      success: jobResult.success,
      jobId: jobResult.jobId,
      leadId: null,
      confirmationMessage: jobResult.success
        ? "You're all set — we've booked your appointment."
        : "We had trouble booking that time — a team member will follow up to schedule.",
    };

    logToolCall({
      businessId: business.id,
      toolName: "book_job",
      phone,
      request: parsed.data,
      // email/equipmentAge ride along the same way create_lead's response
      // does, so the post-call webhook can rebuild the job's summary with
      // the real AI call summary once it's available — see webhooks/postCall.ts.
      response: { ...response, email: existing.email, equipmentAge: resolvedEquipmentAge },
      success: jobResult.success,
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
