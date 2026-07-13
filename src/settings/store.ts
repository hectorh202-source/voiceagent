import crypto from "node:crypto";
import { db } from "../db/index";
import { encryptionKey } from "./encryptionKey";

const ALGO = "aes-256-gcm";

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decrypt(stored: string): string {
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, encryptionKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

const getStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const setStmt = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

export function getSetting(key: string): string | null {
  const row = getStmt.get(key) as { value: string } | undefined;
  if (!row) return null;
  return decrypt(row.value);
}

export function setSetting(key: string, value: string): void {
  setStmt.run(key, encrypt(value));
}

export function hasSetting(key: string): boolean {
  return getSetting(key) !== null;
}

const deleteStmt = db.prepare(`DELETE FROM settings WHERE key = ?`);

export function deleteSetting(key: string): void {
  deleteStmt.run(key);
}

// Per-business equivalents of the functions above — every ElevenLabs/
// ServiceTitan/Operational credential lives here instead, scoped by
// business_id, while `settings` itself keeps only the handful of genuinely
// global keys (the session secret, and the dormant legacy admin password).
// Same encryption, just a different (business-scoped) table underneath.
const getBusinessStmt = db.prepare(`SELECT value FROM business_settings WHERE business_id = ? AND key = ?`);
const setBusinessStmt = db.prepare(`
  INSERT INTO business_settings (business_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const deleteBusinessStmt = db.prepare(`DELETE FROM business_settings WHERE business_id = ? AND key = ?`);

export function getBusinessSetting(businessId: number, key: string): string | null {
  const row = getBusinessStmt.get(businessId, key) as { value: string } | undefined;
  if (!row) return null;
  return decrypt(row.value);
}

export function setBusinessSetting(businessId: number, key: string, value: string): void {
  setBusinessStmt.run(businessId, key, encrypt(value));
}

export function hasBusinessSetting(businessId: number, key: string): boolean {
  return getBusinessSetting(businessId, key) !== null;
}

export function deleteBusinessSetting(businessId: number, key: string): void {
  deleteBusinessStmt.run(businessId, key);
}

// Persisted so login sessions survive server restarts/redeploys instead of
// being invalidated by a freshly-generated secret every time the process starts.
export function getOrCreateSessionSecret(): string {
  const existing = getSetting("internal.sessionSecret");
  if (existing) return existing;
  const secret = crypto.randomBytes(32).toString("hex");
  setSetting("internal.sessionSecret", secret);
  return secret;
}

export type ServiceTitanEnvironment = "integration" | "production";

export interface ServiceTitanConfig {
  environment: ServiceTitanEnvironment;
  authBaseUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  appKey: string;
  tenantId: string;
  defaultBusinessUnitId: string;
  defaultCampaignId: string;
  defaultCallReasonId: string;
  defaultJobTypeId: string;
}

const ST_BASE_URLS: Record<ServiceTitanEnvironment, { auth: string; api: string }> = {
  integration: {
    auth: "https://auth-integration.servicetitan.io",
    api: "https://api-integration.servicetitan.io",
  },
  production: {
    auth: "https://auth.servicetitan.io",
    api: "https://api.servicetitan.io",
  },
};

// Strict, all-fields-required view used only where a complete config is
// actually required to make a real API call (see servicetitan/httpClient.ts).
export function getServiceTitanConfig(businessId: number): ServiceTitanConfig | null {
  const environment =
    (getBusinessSetting(businessId, "servicetitan.environment") as ServiceTitanEnvironment | null) ?? "integration";
  const clientId = getBusinessSetting(businessId, "servicetitan.clientId");
  const clientSecret = getBusinessSetting(businessId, "servicetitan.clientSecret");
  const appKey = getBusinessSetting(businessId, "servicetitan.appKey");
  const tenantId = getBusinessSetting(businessId, "servicetitan.tenantId");
  if (!clientId || !clientSecret || !appKey || !tenantId) return null;

  const urls = ST_BASE_URLS[environment];
  return {
    environment,
    authBaseUrl: urls.auth,
    apiBaseUrl: urls.api,
    clientId,
    clientSecret,
    appKey,
    tenantId,
    defaultBusinessUnitId: getBusinessSetting(businessId, "servicetitan.businessUnitId") ?? "",
    defaultCampaignId: getBusinessSetting(businessId, "servicetitan.campaignId") ?? "",
    defaultCallReasonId: getBusinessSetting(businessId, "servicetitan.callReasonId") ?? "",
    defaultJobTypeId: getBusinessSetting(businessId, "servicetitan.jobTypeId") ?? "",
  };
}

// Per-field views used by the settings page itself: each field is read/shown
// independently, so a partially-filled group never hides fields that *are*
// saved (unlike getServiceTitanConfig, which intentionally requires all of
// its fields at once because that's what a real ServiceTitan API call needs).
export function getRawElevenLabsSettings(businessId: number) {
  return {
    apiKeySet: !!getBusinessSetting(businessId, "elevenlabs.apiKey"),
    agentId: getBusinessSetting(businessId, "elevenlabs.agentId") ?? "",
  };
}

export function getRawServiceTitanSettings(businessId: number) {
  return {
    environment:
      (getBusinessSetting(businessId, "servicetitan.environment") as ServiceTitanEnvironment | null) ?? "integration",
    clientIdSet: !!getBusinessSetting(businessId, "servicetitan.clientId"),
    clientSecretSet: !!getBusinessSetting(businessId, "servicetitan.clientSecret"),
    appKeySet: !!getBusinessSetting(businessId, "servicetitan.appKey"),
    tenantId: getBusinessSetting(businessId, "servicetitan.tenantId") ?? "",
    businessUnitId: getBusinessSetting(businessId, "servicetitan.businessUnitId") ?? "",
    campaignId: getBusinessSetting(businessId, "servicetitan.campaignId") ?? "",
    callReasonId: getBusinessSetting(businessId, "servicetitan.callReasonId") ?? "",
    jobTypeId: getBusinessSetting(businessId, "servicetitan.jobTypeId") ?? "",
    tagName: getBusinessSetting(businessId, "servicetitan.tagName") ?? "",
    bookingMode: getBookingMode(businessId),
  };
}

export type BookingMode = "lead" | "job";

// Per-business choice of what a call produces in ServiceTitan: a Lead for
// staff to confirm and convert (today's only behavior), or a directly
// booked Job with a real reserved appointment slot — see
// servicetitan-integration.md for the full design. Defaults to "lead" so
// every existing business keeps its current behavior with zero setup.
export function getBookingMode(businessId: number): BookingMode {
  return (getBusinessSetting(businessId, "servicetitan.bookingMode") as BookingMode | null) ?? "lead";
}

export function getRawOperationalSettings(businessId: number) {
  return {
    toolWebhookSecretSet: !!getBusinessSetting(businessId, "operational.toolWebhookSecret"),
    postCallWebhookSecretSet: !!getBusinessSetting(businessId, "operational.postCallWebhookSecret"),
    timezone: getBusinessSetting(businessId, "operational.timezone") ?? "America/New_York",
    dashboardBaseUrl: getBusinessSetting(businessId, "operational.dashboardBaseUrl") ?? "",
  };
}

export function getAgentTimezone(businessId: number): string {
  return getBusinessSetting(businessId, "operational.timezone") ?? "America/New_York";
}

// Base URL used to build links to the public /b/:businessId/calls/:conversationId
// page (e.g. inside a ServiceTitan lead's summary). Defaults to this
// deployment's known dashboard domain (same one hardcoded in the Caddyfile)
// so the link works out of the box with no setup — the /settings field only
// exists to override it if this app is ever deployed under a different domain.
export function getDashboardBaseUrl(businessId: number): string {
  return getBusinessSetting(businessId, "operational.dashboardBaseUrl") ?? "https://dashboard.laughslapper.com";
}
