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
export function getServiceTitanConfig(): ServiceTitanConfig | null {
  const environment = (getSetting("servicetitan.environment") as ServiceTitanEnvironment | null) ?? "integration";
  const clientId = getSetting("servicetitan.clientId");
  const clientSecret = getSetting("servicetitan.clientSecret");
  const appKey = getSetting("servicetitan.appKey");
  const tenantId = getSetting("servicetitan.tenantId");
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
    defaultBusinessUnitId: getSetting("servicetitan.businessUnitId") ?? "",
    defaultCampaignId: getSetting("servicetitan.campaignId") ?? "",
    defaultCallReasonId: getSetting("servicetitan.callReasonId") ?? "",
    defaultJobTypeId: getSetting("servicetitan.jobTypeId") ?? "",
  };
}

// Per-field views used by the settings page itself: each field is read/shown
// independently, so a partially-filled group never hides fields that *are*
// saved (unlike getServiceTitanConfig, which intentionally requires all of
// its fields at once because that's what a real ServiceTitan API call needs).
export function getRawElevenLabsSettings() {
  return {
    apiKeySet: !!getSetting("elevenlabs.apiKey"),
    agentId: getSetting("elevenlabs.agentId") ?? "",
  };
}

export function getRawServiceTitanSettings() {
  return {
    environment: (getSetting("servicetitan.environment") as ServiceTitanEnvironment | null) ?? "integration",
    clientIdSet: !!getSetting("servicetitan.clientId"),
    clientSecretSet: !!getSetting("servicetitan.clientSecret"),
    appKeySet: !!getSetting("servicetitan.appKey"),
    tenantId: getSetting("servicetitan.tenantId") ?? "",
    businessUnitId: getSetting("servicetitan.businessUnitId") ?? "",
    campaignId: getSetting("servicetitan.campaignId") ?? "",
    callReasonId: getSetting("servicetitan.callReasonId") ?? "",
    jobTypeId: getSetting("servicetitan.jobTypeId") ?? "",
    tagName: getSetting("servicetitan.tagName") ?? "",
  };
}

export function getRawOperationalSettings() {
  return {
    emergencyTransferNumber: getSetting("operational.emergencyTransferNumber") ?? "",
    toolWebhookSecretSet: !!getSetting("operational.toolWebhookSecret"),
    postCallWebhookSecretSet: !!getSetting("operational.postCallWebhookSecret"),
    timezone: getSetting("operational.timezone") ?? "America/New_York",
    dashboardBaseUrl: getSetting("operational.dashboardBaseUrl") ?? "",
  };
}

export function getAgentTimezone(): string {
  return getSetting("operational.timezone") ?? "America/New_York";
}

// Base URL used to build links to the public /calls/:conversationId page
// (e.g. inside a ServiceTitan lead's summary). Defaults to this deployment's
// known dashboard domain (same one hardcoded in the Caddyfile) so the link
// works out of the box with no setup — the /settings field only exists to
// override it if this app is ever deployed under a different domain.
export function getDashboardBaseUrl(): string {
  return getSetting("operational.dashboardBaseUrl") ?? "https://dashboard.laughslapper.com";
}
