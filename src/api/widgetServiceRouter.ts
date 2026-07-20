import { Router, type Request } from "express";
import crypto from "node:crypto";
import { getBusinessById } from "../db/businesses";
import {
  getChatWidgetConfig,
  getBusinessSetting,
  getBookingMode,
  getAgentTimezone,
  getWidgetServiceApiSecret,
  getWidgetPoweredBy,
} from "../settings/store";

// Service-to-service endpoint for the standalone chat-widget service (separate
// repo). It's mounted under /api but OUTSIDE the browser-session auth — it
// authenticates with the shared X-Widget-Service-Secret instead. GET-only, so
// it also passes the /api same-origin verifyOrigin guard (which only blocks
// state-changing cross-origin requests).
export const widgetServiceRouter = Router();

function isAuthorized(req: Request): boolean {
  const expected = getWidgetServiceApiSecret();
  if (!expected) return false;
  const provided = req.header("X-Widget-Service-Secret");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

widgetServiceRouter.get("/businesses/:businessId/config", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = Number(req.params.businessId);
  if (!Number.isInteger(id) || id <= 0 || !getBusinessById(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const config = getChatWidgetConfig(id);
  if (!config) {
    // Widget disabled or no Anthropic key — the service treats this as "off".
    res.json({ enabled: false });
    return;
  }

  res.json({
    enabled: true,
    anthropicApiKey: config.anthropicApiKey,
    model: config.model,
    branding: config.branding,
    quickPrompts: config.quickPrompts,
    systemPromptExtras: config.systemPromptExtras,
    allowedOrigins: config.allowedOrigins,
    embedKey: config.embedKey,
    bookingMode: getBookingMode(id),
    timezone: getAgentTimezone(id),
    // Platform-level operator attribution shown in the widget footer.
    poweredBy: getWidgetPoweredBy(),
    // The secrets the service uses to authenticate its calls back here.
    toolWebhookSecret: getBusinessSetting(id, "operational.toolWebhookSecret") ?? "",
    leadIntakeWebhookSecret: getBusinessSetting(id, "operational.leadIntakeWebhookSecret") ?? "",
  });
});
