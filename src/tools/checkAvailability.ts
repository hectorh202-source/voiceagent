import type { Request, Response } from "express";
import { z } from "zod";
import { checkAvailability } from "../servicetitan/capacity";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError, describeError } from "../servicetitan/httpClient";
import { getBookingMode, resolveServiceCategory } from "../settings/store";

const bodySchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  // One of that business's configured service category names — resolves to
  // a specific business unit/job type for an accurate capacity check
  // instead of always using the business's single default. Replaces an
  // earlier "jobType" field that was accepted but never actually wired up
  // to filter anything.
  serviceCategory: z.string().optional(),
});

export async function handleCheckAvailability(req: Request, res: Response): Promise<void> {
  const business = req.business;
  if (!business) {
    res.status(404).end();
    return;
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMessage = JSON.stringify(parsed.error.flatten());
    logToolCall({ businessId: business.id, toolName: "check_availability", request: req.body, success: false, errorMessage });
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  try {
    const overrides = resolveServiceCategory(business.id, parsed.data.serviceCategory);
    const result = await checkAvailability(business.id, parsed.data.startDate, parsed.data.endDate, overrides);

    // Lead mode (default): unchanged response shape — no exact slot is ever
    // reserved in this mode, so the vague boolean+note is all the agent
    // needs. Job mode: return real bookable windows for the agent to read
    // aloud, since it's about to actually reserve one via book_job.
    const response =
      getBookingMode(business.id) === "job"
        ? {
            slots: result.slots,
            note: result.slots.length
              ? "Real appointment times are available — offer these to the caller and let them choose one."
              : "No specific times were found in that window; a team member will follow up to schedule.",
          }
        : { hasNearTermAvailability: result.hasNearTermAvailability, note: result.note };

    logToolCall({
      businessId: business.id,
      toolName: "check_availability",
      request: parsed.data,
      response,
      success: true,
    });
    res.json(response);
  } catch (error) {
    const status = error instanceof ServiceTitanNotConfiguredError ? 503 : 502;
    const message = error instanceof ServiceTitanNotConfiguredError ? error.message : describeError(error);
    logToolCall({
      businessId: business.id,
      toolName: "check_availability",
      request: parsed.data,
      success: false,
      errorMessage: message,
    });
    res.status(status).json({ error: message });
  }
}
