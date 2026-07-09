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

export type ServiceTitanEnvironment = "integration" | "production";

export interface ElevenLabsConfig {
  apiKey: string;
  agentId: string;
}

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

export interface OperationalConfig {
  emergencyTransferNumber: string;
  toolWebhookSecret: string;
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

export function getElevenLabsConfig(): ElevenLabsConfig | null {
  const apiKey = getSetting("elevenlabs.apiKey");
  const agentId = getSetting("elevenlabs.agentId");
  if (!apiKey || !agentId) return null;
  return { apiKey, agentId };
}

export function setElevenLabsConfig(config: ElevenLabsConfig): void {
  setSetting("elevenlabs.apiKey", config.apiKey);
  setSetting("elevenlabs.agentId", config.agentId);
}

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

export function setServiceTitanConfig(config: {
  environment: ServiceTitanEnvironment;
  clientId: string;
  clientSecret: string;
  appKey: string;
  tenantId: string;
  defaultBusinessUnitId: string;
  defaultCampaignId: string;
  defaultCallReasonId: string;
  defaultJobTypeId: string;
}): void {
  setSetting("servicetitan.environment", config.environment);
  setSetting("servicetitan.clientId", config.clientId);
  setSetting("servicetitan.clientSecret", config.clientSecret);
  setSetting("servicetitan.appKey", config.appKey);
  setSetting("servicetitan.tenantId", config.tenantId);
  setSetting("servicetitan.businessUnitId", config.defaultBusinessUnitId);
  setSetting("servicetitan.campaignId", config.defaultCampaignId);
  setSetting("servicetitan.callReasonId", config.defaultCallReasonId);
  setSetting("servicetitan.jobTypeId", config.defaultJobTypeId);
}

export function getOperationalConfig(): OperationalConfig | null {
  const emergencyTransferNumber = getSetting("operational.emergencyTransferNumber");
  const toolWebhookSecret = getSetting("operational.toolWebhookSecret");
  if (!emergencyTransferNumber || !toolWebhookSecret) return null;
  return { emergencyTransferNumber, toolWebhookSecret };
}

export function setOperationalConfig(config: OperationalConfig): void {
  setSetting("operational.emergencyTransferNumber", config.emergencyTransferNumber);
  setSetting("operational.toolWebhookSecret", config.toolWebhookSecret);
}
