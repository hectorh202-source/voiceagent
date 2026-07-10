import type { Request, Response } from "express";
import { z } from "zod";
import { lookupCustomerByPhone } from "../servicetitan/customers";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError } from "../servicetitan/httpClient";

const bodySchema = z.object({ phone: z.string().min(4) });

export async function handleLookupCustomer(req: Request, res: Response): Promise<void> {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMessage = JSON.stringify(parsed.error.flatten());
    logToolCall({ toolName: "lookup_customer", request: req.body, success: false, errorMessage });
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { phone } = parsed.data;

  try {
    const result = await lookupCustomerByPhone(phone);
    logToolCall({ toolName: "lookup_customer", phone, request: parsed.data, response: result, success: true });
    res.json(result);
  } catch (error) {
    const status = error instanceof ServiceTitanNotConfiguredError ? 503 : 502;
    const message = error instanceof Error ? error.message : "Unknown error";
    logToolCall({ toolName: "lookup_customer", phone, request: parsed.data, success: false, errorMessage: message });
    res.status(status).json({ error: message });
  }
}
