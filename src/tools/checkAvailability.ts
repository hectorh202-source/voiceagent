import type { Request, Response } from "express";
import { z } from "zod";
import { checkAvailability } from "../servicetitan/capacity";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError, describeError } from "../servicetitan/httpClient";

const bodySchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  jobType: z.string().optional(),
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
    const result = await checkAvailability(business.id, parsed.data.startDate, parsed.data.endDate);
    logToolCall({
      businessId: business.id,
      toolName: "check_availability",
      request: parsed.data,
      response: result,
      success: true,
    });
    res.json(result);
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
