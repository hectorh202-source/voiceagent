import { Router } from "express";
import { z } from "zod";
import { requireApiSession } from "./requireApiSession";
import { requireApiPlatformAdmin } from "./requireApiPlatformAdmin";
import { emailSettingsSchema, testEmailSchema, twilioSettingsSchema, googleAdsSettingsSchema } from "./schemas";
import { createBusiness, listBusinesses, getBusinessById } from "../db/businesses";
import { createUser, listUsers, deleteUser, setPlatformAdmin } from "../db/users";
import { getUserBusinessIds, setUserBusinesses, removeUserFromBusiness } from "../db/userBusinesses";
import {
  getRawEmailSettings,
  getRawTwilioSettings,
  getRawGoogleAdsSettings,
  setSetting,
  maybeSetSetting,
} from "../settings/store";
import { sendTestEmail, EmailNotConfiguredError } from "../settings/email";

// The JSON counterpart of the global, server-rendered /settings business/user
// console (src/settings/routes.ts) — same underlying db functions, just
// returning JSON instead of redirecting/rendering HTML, so the React SPA's
// Admin Settings page can drive the same actions in-app. Every route here is
// platform-admin-only; a non-admin session gets a 403, same as
// apiBusinessRouter's requireBusinessAccess does for business-scoped routes.
export const adminRouter = Router();

adminRouter.use(requireApiSession);
adminRouter.use(requireApiPlatformAdmin);

adminRouter.get("/businesses", (_req, res) => {
  res.json({ businesses: listBusinesses() });
});

const createBusinessSchema = z.object({ name: z.string().trim().min(1) });

adminRouter.post("/businesses", (req, res) => {
  const parsed = createBusinessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a business name." });
    return;
  }
  const business = createBusiness(parsed.data.name);
  res.json({ business });
});

adminRouter.get("/users", (_req, res) => {
  const users = listUsers();
  res.json({
    users: users.map((u) => ({ ...u, businessIds: getUserBusinessIds(u.id) })),
  });
});

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  isPlatformAdmin: z.boolean().optional().default(false),
  businessIds: z.array(z.number().int()).optional().default([]),
});

adminRouter.post("/users", (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and an 8+ character password.", details: parsed.error.flatten() });
    return;
  }
  const { email, password, isPlatformAdmin, businessIds } = parsed.data;
  try {
    const user = createUser(email, password, isPlatformAdmin);
    if (!isPlatformAdmin) setUserBusinesses(user.id, businessIds);
    res.json({ success: true });
  } catch {
    res.status(409).json({ error: "That email is already in use." });
  }
});

const accessSchema = z.object({
  isPlatformAdmin: z.boolean().optional().default(false),
  businessIds: z.array(z.number().int()).optional().default([]),
});

adminRouter.post("/users/:id/access", (req, res) => {
  const id = Number(req.params.id);
  const parsed = accessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  // Mirrors the equivalent guard in settings/routes.ts — revoking your own
  // admin access here could lock you out of this console entirely with no
  // one else able to restore it.
  if (id === req.currentUser!.id && !parsed.data.isPlatformAdmin) {
    res.status(400).json({ error: "You cannot remove your own platform admin access." });
    return;
  }
  setPlatformAdmin(id, parsed.data.isPlatformAdmin);
  setUserBusinesses(id, parsed.data.isPlatformAdmin ? [] : parsed.data.businessIds);
  res.json({ success: true });
});

adminRouter.delete("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.currentUser!.id) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }
  deleteUser(id);
  res.json({ success: true });
});

// A business's own admin console (client/src/pages/AdminSettingsPage.tsx in
// its per-business mode) manages that business's users directly, rather
// than through the global add-user form — which only ever creates platform
// admins now. These two routes only ever touch this one business's
// membership row for a user, never their access to any other business.
const createBusinessUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
});

adminRouter.post("/businesses/:businessId/users", (req, res) => {
  const businessId = Number(req.params.businessId);
  if (!Number.isInteger(businessId) || businessId <= 0 || !getBusinessById(businessId)) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const parsed = createBusinessUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and an 8+ character password." });
    return;
  }
  try {
    // A brand-new user has no existing memberships to preserve, so
    // replace-all and single-business-add are equivalent here.
    const user = createUser(parsed.data.email, parsed.data.password, false);
    setUserBusinesses(user.id, [businessId]);
    res.json({ success: true });
  } catch {
    res.status(409).json({ error: "That email is already in use." });
  }
});

adminRouter.delete("/businesses/:businessId/users/:userId", (req, res) => {
  const businessId = Number(req.params.businessId);
  const userId = Number(req.params.userId);
  removeUserFromBusiness(userId, businessId);
  res.json({ success: true });
});

// SMTP settings for the forgot-password email flow (src/settings/email.ts).
// Global, not business-scoped — login isn't tied to any one business — so
// this reads/writes the plain `settings` table via store.ts rather than
// business_settings.
adminRouter.get("/email-settings", (_req, res) => {
  res.json(getRawEmailSettings());
});

adminRouter.put("/email-settings", (req, res) => {
  const parsed = emailSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  maybeSetSetting("email.smtpHost", body.smtpHost);
  maybeSetSetting("email.smtpUsername", body.smtpUsername);
  maybeSetSetting("email.smtpPassword", body.smtpPassword);
  maybeSetSetting("email.fromAddress", body.fromAddress);
  maybeSetSetting("email.fromName", body.fromName);
  // Select/checkbox-backed fields always write, same reasoning as
  // servicetitan.environment in businessRouter.ts — there's no "blank" state
  // for a port number or a toggle to distinguish from "left unchanged".
  if (body.smtpPort) setSetting("email.smtpPort", body.smtpPort);
  if (body.smtpSecure !== undefined) setSetting("email.smtpSecure", body.smtpSecure ? "true" : "false");
  res.json({ success: true });
});

adminRouter.post("/email-settings/test-email", async (req, res) => {
  const parsed = testEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  try {
    await sendTestEmail(parsed.data.to);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error("Test email failed to send:", err);
    res.status(502).json({ error: "Failed to send — check your SMTP settings and try again." });
  }
});

// The single master Twilio account this platform manages — individual phone
// numbers are assigned to businesses for forwarding, rather than each
// business bringing its own Twilio account, so this is global (like
// email-settings above) rather than living on any one business's General
// Settings. See webhooks/twilio.ts for what these credentials are used for.
adminRouter.get("/twilio-settings", (_req, res) => {
  res.json(getRawTwilioSettings());
});

adminRouter.put("/twilio-settings", (req, res) => {
  const parsed = twilioSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  maybeSetSetting("twilio.accountSid", body.accountSid);
  maybeSetSetting("twilio.authToken", body.authToken);
  res.json({ success: true });
});

// The OAuth Client ID/Secret + Developer Token this platform's Google Ads
// API access is registered under — global for the same reason Twilio's
// master account is global (one shared piece of infrastructure), even
// though each business's own refreshToken/customerId (below, on that
// business's General Settings page) is genuinely per-business. See
// docs/google-lsa-leads.md.
adminRouter.get("/google-ads-settings", (_req, res) => {
  res.json(getRawGoogleAdsSettings());
});

adminRouter.put("/google-ads-settings", (req, res) => {
  const parsed = googleAdsSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  maybeSetSetting("googleAds.developerToken", body.developerToken);
  maybeSetSetting("googleAds.clientId", body.clientId);
  maybeSetSetting("googleAds.clientSecret", body.clientSecret);
  maybeSetSetting("googleAds.loginCustomerId", body.loginCustomerId);
  res.json({ success: true });
});
