import type { Request, Response } from "express";
import { z } from "zod";
import { lookupCustomerByPhone } from "../servicetitan/customers";
import { logToolCall } from "../db/callLog";
import { ServiceTitanNotConfiguredError, describeError } from "../servicetitan/httpClient";
import { isDynamicMemoryEnabled } from "../settings/store";
import { getCallMemory } from "../db/callMemory";

// conversationId is optional (older agent configs / any business that
// hasn't wired it up yet just won't have it) — see docs/elevenlabs-tools.md's
// lookup_customer section for the system__conversation_id dynamic-variable
// setup this depends on. Its only purpose is call_log.conversation_id
// (populated automatically by callLog.ts's extractConversationId), which is
// what lets buildCallDetailViewModel/parseCallRow fall back to this tool's
// resolved name/address when a call never reaches create_lead/book_job.
const bodySchema = z.object({ phone: z.string().min(4), conversationId: z.string().optional() });

export async function handleLookupCustomer(req: Request, res: Response): Promise<void> {
  const business = req.business;
  if (!business) {
    res.status(404).end();
    return;
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMessage = JSON.stringify(parsed.error.flatten());
    logToolCall({ businessId: business.id, toolName: "lookup_customer", request: req.body, success: false, errorMessage });
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { phone } = parsed.data;

  try {
    const result = await lookupCustomerByPhone(business.id, phone);

    // Dynamic memory (see docs/dynamic-memory.md) piggybacks on this tool
    // call rather than a separate webhook, so a failure here just means no
    // memory context for this greeting, never a broken call. Read failure
    // is isolated in its own try/catch so it can never turn an otherwise-
    // successful customer lookup into a failed tool call.
    let lastCallSummary: string | null = null;
    if (isDynamicMemoryEnabled(business.id)) {
      try {
        const memory = getCallMemory(business.id, phone);
        lastCallSummary = memory?.lastSummary ?? null;
      } catch (error) {
        console.error("getCallMemory failed, proceeding without it:", error);
      }
    }

    const response = { ...result, lastCallSummary };
    logToolCall({
      businessId: business.id,
      toolName: "lookup_customer",
      phone,
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
      toolName: "lookup_customer",
      phone,
      request: parsed.data,
      success: false,
      errorMessage: message,
    });
    res.status(status).json({ error: message });
  }
}
