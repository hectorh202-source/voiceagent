import crypto from "node:crypto";
import { db } from "../db/index";
import { encryptField as encrypt, decryptField as decrypt } from "../lib/encryption";

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

// Saves a field only if a non-blank value was submitted, otherwise leaves
// whatever's already stored untouched — the shared "leave blank to keep
// current" behavior used by every settings form/API for secret and
// non-secret fields alike.
export function maybeSetBusinessSetting(businessId: number, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    setBusinessSetting(businessId, key, trimmed);
  }
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

export interface ElevenLabsConfig {
  apiKey: string;
  agentId: string;
}

// Strict, both-fields-required view used only where a real ElevenLabs API
// call is actually being made (see elevenlabs/httpClient.ts) — mirrors
// getServiceTitanConfig's reasoning above.
export function getElevenLabsConfig(businessId: number): ElevenLabsConfig | null {
  const apiKey = getBusinessSetting(businessId, "elevenlabs.apiKey");
  const agentId = getBusinessSetting(businessId, "elevenlabs.agentId");
  if (!apiKey || !agentId) return null;
  return { apiKey, agentId };
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
}

// Global, not business-scoped — there's a single master Twilio account this
// platform manages, with individual phone numbers assigned to businesses for
// forwarding, rather than each business bringing its own Twilio account.
// Lives in `settings` (encrypted, same as the SMTP credentials/session
// secret) rather than `business_settings`. Strict/all-required, same
// reasoning as getServiceTitanConfig/getSmtpConfig: a partial config should
// behave exactly like no config rather than silently trying and failing.
export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = getSetting("twilio.accountSid");
  const authToken = getSetting("twilio.authToken");
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

export function getRawTwilioSettings() {
  return {
    accountSidSet: !!getSetting("twilio.accountSid"),
    authTokenSet: !!getSetting("twilio.authToken"),
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
    serviceCategories: getServiceCategories(businessId),
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

export interface ServiceCategory {
  name: string;
  businessUnitId: string;
  jobTypeId: string;
}

// Lets a business categorize calls (e.g. "Plumbing" vs "HVAC") into the
// correct business unit + job type, instead of every lead/job getting the
// same single default regardless of what the call was about. Stored as one
// JSON-encoded array rather than a new table — business_settings is a flat
// key-value store and this list is small, so a dedicated table/migration
// isn't worth it.
export function getServiceCategories(businessId: number): ServiceCategory[] {
  const raw = getBusinessSetting(businessId, "servicetitan.serviceCategories");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ServiceCategory[];
  } catch {
    return [];
  }
}

// {} (both fields undefined) when no category name is given or none match —
// callers treat that identically to "no override," falling back to their
// own config defaults. This keeps every caller's zero-config behavior
// exactly unchanged.
export function resolveServiceCategory(
  businessId: number,
  categoryName: string | undefined,
): { businessUnitId?: string; jobTypeId?: string } {
  if (!categoryName) return {};
  const normalized = categoryName.trim().toLowerCase();
  const match = getServiceCategories(businessId).find((c) => c.name.trim().toLowerCase() === normalized);
  return match ? { businessUnitId: match.businessUnitId, jobTypeId: match.jobTypeId } : {};
}

export function getRawOperationalSettings(businessId: number) {
  return {
    toolWebhookSecretSet: !!getBusinessSetting(businessId, "operational.toolWebhookSecret"),
    postCallWebhookSecretSet: !!getBusinessSetting(businessId, "operational.postCallWebhookSecret"),
    timezone: getBusinessSetting(businessId, "operational.timezone") ?? "America/New_York",
    dashboardBaseUrl: getBusinessSetting(businessId, "operational.dashboardBaseUrl") ?? "",
    // This business's own assigned number under the single master Twilio
    // account (see settings/store.ts's getTwilioConfig) — used only by
    // twilio/pollCalls.ts to match an in-progress Twilio call back to this
    // business, since the master account has no other per-business number
    // mapping stored anywhere.
    twilioPhoneNumber: getBusinessSetting(businessId, "operational.twilioPhoneNumber") ?? "",
    leadIntakeWebhookSecretSet: !!getBusinessSetting(businessId, "operational.leadIntakeWebhookSecret"),
    dynamicMemoryEnabled: getBusinessSetting(businessId, "operational.dynamicMemoryEnabled") === "true",
  };
}

// Cross-call memory by phone number (see docs/dynamic-memory.md) — default
// off. Checked on both sides: tools/lookupCustomer.ts only includes
// lastCallSummary in its response when this is true, and the post-call
// write side (webhooks/postCall.ts) only upserts a memory row when this is
// true — so a business that hasn't opted in sees zero behavior change.
export function isDynamicMemoryEnabled(businessId: number): boolean {
  return getBusinessSetting(businessId, "operational.dynamicMemoryEnabled") === "true";
}

export interface GoogleAdsPlatformConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  // The Customer ID of the Manager (MCC) account the Developer Token above
  // is issued under — confirmed required (2026-07-17): Google's API Center
  // only ever issues Developer Tokens to a Manager account, never a
  // standalone one, so every real API call needs this sent as a
  // `login-customer-id` header alongside the target business's own
  // customerId in the URL (see GoogleLsaConfig below). One manager account
  // serves every business on this platform (a Manager account can have many
  // client accounts linked under it), so this is global, not per-business —
  // the per-business piece is which client account (customerId) is being
  // queried, not which manager account is asking. See docs/google-lsa-leads.md.
  loginCustomerId: string;
}

// Global — the OAuth "app identity" (Client ID/Secret), Developer Token, and
// Manager account ID the platform operator registers once with Google, not
// per-business. One registered OAuth client can mint access tokens against
// many separate businesses' own Google Ads accounts (each business grants
// its own consent and gets its own refresh token — see getGoogleLsaConfig
// below), unlike ServiceTitan where every credential including client
// id/secret is genuinely separate per tenant. See docs/google-lsa-leads.md.
export function getGoogleAdsPlatformConfig(): GoogleAdsPlatformConfig | null {
  const developerToken = getSetting("googleAds.developerToken");
  const clientId = getSetting("googleAds.clientId");
  const clientSecret = getSetting("googleAds.clientSecret");
  const loginCustomerId = getSetting("googleAds.loginCustomerId");
  if (!developerToken || !clientId || !clientSecret || !loginCustomerId) return null;
  return { developerToken, clientId, clientSecret, loginCustomerId };
}

export function getRawGoogleAdsSettings() {
  return {
    developerTokenSet: !!getSetting("googleAds.developerToken"),
    clientIdSet: !!getSetting("googleAds.clientId"),
    clientSecretSet: !!getSetting("googleAds.clientSecret"),
    // Not a secret (an account number, same treatment as a business's own
    // googleAds.customerId below) — shown in plain text rather than a
    // password-masked "set" flag.
    loginCustomerId: getSetting("googleAds.loginCustomerId") ?? "",
  };
}

export interface GoogleLsaConfig extends GoogleAdsPlatformConfig {
  refreshToken: string;
  customerId: string;
}

// Strict, all-required view used only where a real Google Ads API call is
// actually being made (see googleLsa/httpClient.ts) — combines the global
// platform config above with this business's own refreshToken/customerId,
// so every caller (src/googleLsa/*) gets one flat config and never needs to
// know two different settings tables are involved, mirroring
// getServiceTitanConfig/getElevenLabsConfig's own reasoning.
export function getGoogleLsaConfig(businessId: number): GoogleLsaConfig | null {
  const platform = getGoogleAdsPlatformConfig();
  if (!platform) return null;
  const refreshToken = getBusinessSetting(businessId, "googleAds.refreshToken");
  const customerId = getBusinessSetting(businessId, "googleAds.customerId");
  if (!refreshToken || !customerId) return null;
  return { ...platform, refreshToken, customerId };
}

// Per-business view for the settings UI — mirrors getRawElevenLabsSettings'
// shape (a plain identifier plus a "set" flag for the actual secret).
export function getRawGoogleAdsBusinessSettings(businessId: number) {
  return {
    customerId: getBusinessSetting(businessId, "googleAds.customerId") ?? "",
    refreshTokenSet: !!getBusinessSetting(businessId, "googleAds.refreshToken"),
  };
}

export function getAgentTimezone(businessId: number): string {
  return getBusinessSetting(businessId, "operational.timezone") ?? "America/New_York";
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

// Global, not business-scoped — login/password-reset isn't tied to any one
// business, so this lives in `settings` (encrypted, same as the session
// secret) rather than `business_settings`. Strict/all-required, mirroring
// getServiceTitanConfig's reasoning: an email actually needs every one of
// these to send at all, so a partial config should behave exactly like no
// config rather than silently trying and failing.
export function getSmtpConfig(): SmtpConfig | null {
  const host = getSetting("email.smtpHost");
  const username = getSetting("email.smtpUsername");
  const password = getSetting("email.smtpPassword");
  const fromAddress = getSetting("email.fromAddress");
  if (!host || !username || !password || !fromAddress) return null;
  return {
    host,
    port: Number(getSetting("email.smtpPort") ?? "587"),
    secure: getSetting("email.smtpSecure") === "true",
    username,
    password,
    fromAddress,
    fromName: getSetting("email.fromName") ?? "Voice Agent Platform",
  };
}

// Per-field view for the admin settings UI — same "leave blank to keep"
// pattern as every other credential in this app (see maybeSetBusinessSetting
// below): the password is only ever reported as set/unset, never echoed back.
export function getRawEmailSettings() {
  return {
    smtpHost: getSetting("email.smtpHost") ?? "",
    smtpPort: getSetting("email.smtpPort") ?? "587",
    smtpSecure: getSetting("email.smtpSecure") === "true",
    smtpUsername: getSetting("email.smtpUsername") ?? "",
    smtpPasswordSet: !!getSetting("email.smtpPassword"),
    fromAddress: getSetting("email.fromAddress") ?? "",
    fromName: getSetting("email.fromName") ?? "",
  };
}

// Same "blank means unchanged" semantics as maybeSetBusinessSetting, for the
// global (non-business-scoped) settings table.
export function maybeSetSetting(key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    setSetting(key, trimmed);
  }
}

// Base URL used to build links to the public /b/:businessId/calls/:conversationId
// page (e.g. inside a ServiceTitan lead's summary). Defaults to this
// deployment's known dashboard domain (same one hardcoded in the Caddyfile)
// so the link works out of the box with no setup — the /settings field only
// exists to override it if this app is ever deployed under a different domain.
export function getDashboardBaseUrl(businessId: number): string {
  return getBusinessSetting(businessId, "operational.dashboardBaseUrl") ?? "https://dashboard.laughslapper.com";
}

// ---------------------------------------------------------------------------
// Website chat widget (see src/chat/* and src/widget/*)
// ---------------------------------------------------------------------------

// The Claude models offered per business for the chat widget. Opus 4.8 is the
// default (best qualifying-conversation quality); Sonnet 5 / Haiku 4.5 are
// selectable to trade quality for cost on high-traffic sites. Kept as a fixed
// allowlist so an arbitrary/typo'd model string can never reach the API.
export const CHAT_WIDGET_MODELS = ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"] as const;
export type ChatWidgetModel = (typeof CHAT_WIDGET_MODELS)[number];
const DEFAULT_CHAT_WIDGET_MODEL: ChatWidgetModel = "claude-opus-4-8";

// The Anthropic API key powering the widget. Per-business for consistency with
// every other credential in this app, but falls back to a single global key
// (settings table) so the operator can run every business off one platform key
// if they prefer — getChatWidgetConfig treats either as sufficient.
export function getAnthropicApiKey(businessId: number): string | null {
  return getBusinessSetting(businessId, "credentials.anthropicApiKey") ?? getSetting("anthropic.apiKey");
}

// The public embed key baked into the <script> snippet on client sites. Not a
// secret (see middleware/verifyWidgetRequest.ts's threat model) — its job is
// to identify the business, with the origin allowlist doing the real gating.
// Generated on first read so enabling the widget never requires a separate
// "generate key" step.
export function getOrCreateWidgetEmbedKey(businessId: number): string {
  const existing = getBusinessSetting(businessId, "chatWidget.embedKey");
  if (existing) return existing;
  const key = crypto.randomBytes(24).toString("base64url");
  setBusinessSetting(businessId, "chatWidget.embedKey", key);
  return key;
}

// Origins are stored as a JSON array of scheme+host(+port) strings (e.g.
// "https://acme.com"). The settings UI writes it; the widget middleware reads
// it to CORS-allow and gate requests. Malformed storage degrades to [] rather
// than throwing.
export function getWidgetAllowedOrigins(businessId: number): string[] {
  const raw = getBusinessSetting(businessId, "chatWidget.allowedOrigins");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === "string") : [];
  } catch {
    return [];
  }
}

export function isChatWidgetEnabled(businessId: number): boolean {
  return getBusinessSetting(businessId, "chatWidget.enabled") === "true";
}

export function getChatWidgetModel(businessId: number): ChatWidgetModel {
  const stored = getBusinessSetting(businessId, "chatWidget.model") as ChatWidgetModel | null;
  return stored && (CHAT_WIDGET_MODELS as readonly string[]).includes(stored) ? stored : DEFAULT_CHAT_WIDGET_MODEL;
}

export interface ChatWidgetBranding {
  agentName: string;
  accentColor: string;
  greeting: string;
  // Image URL shown in the widget's header (and as the assistant's avatar).
  // A URL rather than an upload: businesses already host a logo on their own
  // site, and this avoids adding file storage/serving to the platform.
  logoUrl: string;
  // Short line under the header title, e.g. "Typically replies in a minute".
  tagline: string;
}

export function getChatWidgetBranding(businessId: number): ChatWidgetBranding {
  return {
    agentName: getBusinessSetting(businessId, "chatWidget.agentName") ?? "Assistant",
    accentColor: getBusinessSetting(businessId, "chatWidget.accentColor") ?? "#2563eb",
    greeting:
      getBusinessSetting(businessId, "chatWidget.greeting") ??
      "Hi! I can help you book a service or answer questions. How can I help?",
    logoUrl: getBusinessSetting(businessId, "chatWidget.logoUrl") ?? "",
    tagline: getBusinessSetting(businessId, "chatWidget.tagline") ?? "",
  };
}

// Clickable starter prompts shown under the greeting (e.g. "Book a service").
// Clicking one sends it as the visitor's first message, so a visitor never
// faces a blank box. Stored as a JSON array of short labels; malformed storage
// degrades to [] rather than throwing.
export function getChatWidgetQuickPrompts(businessId: number): string[] {
  const raw = getBusinessSetting(businessId, "chatWidget.quickPrompts");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

// Free-text business context the operator adds to the widget's system prompt
// (services offered, hours, service area, tone). "" when unset.
export function getChatWidgetSystemPromptExtras(businessId: number): string {
  return getBusinessSetting(businessId, "chatWidget.systemPromptExtras") ?? "";
}

export interface ChatWidgetConfig {
  enabled: boolean;
  embedKey: string;
  allowedOrigins: string[];
  model: ChatWidgetModel;
  branding: ChatWidgetBranding;
  quickPrompts: string[];
  systemPromptExtras: string;
  anthropicApiKey: string;
}

// Strict, all-required-to-run view — returns null unless the widget is enabled
// AND an Anthropic key is available. Same reasoning as getServiceTitanConfig/
// getElevenLabsConfig: a half-configured widget should behave exactly like a
// disabled one rather than 500 on the first message.
export function getChatWidgetConfig(businessId: number): ChatWidgetConfig | null {
  if (!isChatWidgetEnabled(businessId)) return null;
  const anthropicApiKey = getAnthropicApiKey(businessId);
  if (!anthropicApiKey) return null;
  return {
    enabled: true,
    embedKey: getOrCreateWidgetEmbedKey(businessId),
    allowedOrigins: getWidgetAllowedOrigins(businessId),
    model: getChatWidgetModel(businessId),
    branding: getChatWidgetBranding(businessId),
    quickPrompts: getChatWidgetQuickPrompts(businessId),
    systemPromptExtras: getChatWidgetSystemPromptExtras(businessId),
    anthropicApiKey,
  };
}

// Per-field view for the settings UI — mirrors getRawElevenLabsSettings: the
// Anthropic key is only reported set/unset, never echoed back; everything else
// is shown for editing. embedKey is safe to show (it's public by design).
export function getRawChatWidgetSettings(businessId: number) {
  return {
    enabled: isChatWidgetEnabled(businessId),
    embedKey: getBusinessSetting(businessId, "chatWidget.embedKey") ?? "",
    anthropicApiKeySet: !!getAnthropicApiKey(businessId),
    allowedOrigins: getWidgetAllowedOrigins(businessId),
    model: getChatWidgetModel(businessId),
    ...getChatWidgetBranding(businessId),
    quickPrompts: getChatWidgetQuickPrompts(businessId),
    systemPromptExtras: getChatWidgetSystemPromptExtras(businessId),
  };
}

// The standalone chat-widget SERVICE (separate repo) fetches per-business
// config from this dashboard using a shared service secret, and the install
// snippet points at the service's own base URL. Both are global (one widget
// service serves every business), so they live in the `settings` table, not
// business_settings — same reasoning as the master Twilio/Google-Ads config.
export function getWidgetServiceApiSecret(): string | null {
  return getSetting("widgetService.apiSecret");
}

export function getWidgetServiceBaseUrl(): string {
  return getSetting("widgetService.baseUrl") ?? "";
}

// The platform operator's own "Powered by" attribution, shown in the footer of
// every business's widget. Global, not per-business: it's the agency's brand,
// identical across every client site, and doubles as a referral link back.
export interface WidgetPoweredBy {
  name: string;
  url: string;
}

export function getWidgetPoweredBy(): WidgetPoweredBy {
  return {
    name: getSetting("widgetService.poweredByName") ?? "",
    url: getSetting("widgetService.poweredByUrl") ?? "",
  };
}

export function getRawWidgetServiceSettings() {
  return {
    apiSecretSet: !!getSetting("widgetService.apiSecret"),
    baseUrl: getSetting("widgetService.baseUrl") ?? "",
    ...getWidgetPoweredBy(),
  };
}
