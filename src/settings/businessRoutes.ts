import { Router } from "express";
import crypto from "node:crypto";
import {
  setBusinessSetting,
  getRawElevenLabsSettings,
  getRawServiceTitanSettings,
  getRawOperationalSettings,
  type ServiceTitanEnvironment,
  type BookingMode,
  type ServiceCategory,
} from "./store";
import { requireAdminSession } from "../middleware/requireAdminSession";
import { renderSettingsPage } from "./views";

// Per-business credentials form — mounted at /b/:businessId/settings by
// index.ts, behind the same global resolveBusiness + requireAdminSession
// gates as the rest of the /b/:businessId router. Adding/removing platform
// users and the business list itself live in settings/routes.ts instead
// (global concerns, not scoped to one business).
export const businessSettingsRouter = Router();

// Saves a field only if a non-blank value was submitted, otherwise leaves
// whatever's already stored untouched (used for the "leave blank to keep
// current" behavior on every settings field, secret or not).
function maybeSet(businessId: number, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    setBusinessSetting(businessId, key, trimmed);
  }
}

businessSettingsRouter.get("/", requireAdminSession, (req, res) => {
  const business = req.business!;
  const flash = req.session.flash;
  req.session.flash = undefined;
  res.send(
    renderSettingsPage({
      business,
      elevenLabs: getRawElevenLabsSettings(business.id),
      serviceTitan: getRawServiceTitanSettings(business.id),
      operational: getRawOperationalSettings(business.id),
      flash,
    }),
  );
});

businessSettingsRouter.post("/", requireAdminSession, (req, res) => {
  const business = req.business!;
  const body = req.body as Record<string, string | undefined>;

  maybeSet(business.id, "elevenlabs.apiKey", body.elevenLabsApiKey);
  maybeSet(business.id, "elevenlabs.agentId", body.elevenLabsAgentId);

  setBusinessSetting(
    business.id,
    "servicetitan.environment",
    (body.serviceTitanEnvironment as ServiceTitanEnvironment) || "integration",
  );
  maybeSet(business.id, "servicetitan.clientId", body.serviceTitanClientId);
  maybeSet(business.id, "servicetitan.clientSecret", body.serviceTitanClientSecret);
  maybeSet(business.id, "servicetitan.appKey", body.serviceTitanAppKey);
  maybeSet(business.id, "servicetitan.tenantId", body.serviceTitanTenantId);
  maybeSet(business.id, "servicetitan.businessUnitId", body.serviceTitanBusinessUnitId);
  maybeSet(business.id, "servicetitan.campaignId", body.serviceTitanCampaignId);
  maybeSet(business.id, "servicetitan.callReasonId", body.serviceTitanCallReasonId);
  maybeSet(business.id, "servicetitan.jobTypeId", body.serviceTitanJobTypeId);
  maybeSet(business.id, "servicetitan.tagName", body.serviceTitanTagName);
  setBusinessSetting(business.id, "servicetitan.bookingMode", (body.serviceTitanBookingMode as BookingMode) || "lead");

  // 10 fixed rows, not dynamic add/remove — blank-name rows are dropped
  // rather than saved as empty categories.
  const categories: ServiceCategory[] = [];
  for (let i = 0; i < 10; i++) {
    const name = body[`serviceCategoryName${i}`]?.trim();
    if (!name) continue;
    categories.push({
      name,
      businessUnitId: body[`serviceCategoryBusinessUnitId${i}`]?.trim() ?? "",
      jobTypeId: body[`serviceCategoryJobTypeId${i}`]?.trim() ?? "",
    });
  }
  setBusinessSetting(business.id, "servicetitan.serviceCategories", JSON.stringify(categories));

  setBusinessSetting(business.id, "operational.timezone", body.timezone || "America/New_York");
  maybeSet(business.id, "operational.dashboardBaseUrl", body.dashboardBaseUrl?.replace(/\/+$/, ""));
  maybeSet(business.id, "operational.toolWebhookSecret", body.toolWebhookSecret);
  maybeSet(business.id, "operational.postCallWebhookSecret", body.postCallWebhookSecret);

  req.session.flash = { type: "success", message: "Settings saved." };
  res.redirect(`/b/${business.id}/settings`);
});

businessSettingsRouter.post("/generate-secret", requireAdminSession, (req, res) => {
  const business = req.business!;
  const secret = crypto.randomBytes(24).toString("hex");
  setBusinessSetting(business.id, "operational.toolWebhookSecret", secret);
  req.session.flash = {
    type: "success",
    message: `New tool webhook secret: ${secret} — copy it into ElevenLabs now, it will be masked after you leave this page.`,
  };
  res.redirect(`/b/${business.id}/settings`);
});
