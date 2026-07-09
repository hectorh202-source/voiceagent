import type { Request, Response } from "express";
import { z } from "zod";
import { checkAvailability } from "../servicetitan/capacity";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError } from "../servicetitan/httpClient";

const bodySchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  jobType: z.string().optional(),
});

export async function handleCheckAvailability(req: Request, res: Response): Promise<void> {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await checkAvailability(parsed.data.startDate, parsed.data.endDate);
    logToolCall({ toolName: "check_availability", request: parsed.data, response: result, success: true });
    res.json(result);
  } catch (error) {
    const status = error instanceof ServiceTitanNotConfiguredError ? 503 : 502;
    const message = error instanceof Error ? error.message : "Unknown error";
    logToolCall({ toolName: "check_availability", request: parsed.data, success: false, errorMessage: message });
    res.status(status).json({ error: message });
  }
}
