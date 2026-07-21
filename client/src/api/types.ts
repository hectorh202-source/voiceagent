export interface SessionUser {
  id: number;
  email: string;
  isPlatformAdmin: boolean;
}

export type AuthState = "fresh" | "needs_migration" | "ready";

export interface AuthStateResponse {
  state: AuthState;
  authenticated: boolean;
}

export interface Business {
  id: number;
  name: string;
  createdAt: string;
}

export interface AdminUser {
  id: number;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  isPlatformAdmin: boolean;
  businessIds: number[];
}

export interface EmailSettings {
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPasswordSet: boolean;
  fromAddress: string;
  fromName: string;
}

export type CallStatus = "booked" | "not_booked" | "excused";
export type CallHandler = "ai" | "ai_human";
export type RecoveryStatus = "recovered" | "not_recovered" | null;

export interface CallFlags {
  failedTransfer: boolean;
  noBookingCreated: boolean;
  endedEarly: boolean;
}

export interface CallHistoryRow {
  conversationId: string;
  receivedAt: string;
  durationSecs: number | null;
  customerName: string | null;
  phone: string | null;
  status: CallStatus;
  isEmergency: boolean | null;
  isTransferred: boolean;
  summary: string | null;
}

export interface CallListRow {
  conversationId: string;
  receivedAt: string;
  durationSecs: number | null;
  customerName: string | null;
  phone: string | null;
  isEmergency: boolean | null;
  callHandler: CallHandler;
  status: CallStatus;
  autoStatus: CallStatus;
  statusOverride: CallStatus | null;
  callReason: string | null;
  autoCallReason: string | null;
  callReasonOverride: string | null;
  isRead: boolean;
  recoveryStatus: RecoveryStatus;
  leadId: string | null;
  jobId: string | null;
  leadUrl: string | null;
  jobUrl: string | null;
  flags: CallFlags;
}

export interface CallDetail {
  businessId: number;
  conversationId: string;
  callTime: string;
  company: string;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  email: string;
  propertyType: string;
  isEmergency: boolean | null;
  leadId: string | null;
  leadUrl: string | null;
  jobId: string | null;
  jobUrl: string | null;
  isTransferred: boolean;
  forwardedNumber: string | null;
  transferDestination: string | null;
  transferFailed: boolean;
  summary: string | null;
  transcript: { role: string; message: string; timeLabel: string }[];
  terminationReason: string | null;
  hasAudio: boolean;
  hasHumanRecording: boolean;
  humanRecordingOffsetSecs: number | null;
  status: CallStatus;
  autoStatus: CallStatus;
  statusOverride: CallStatus | null;
  durationSecs: number | null;
  callReason: string | null;
  autoCallReason: string | null;
  callReasonOverride: string | null;
  isRead: boolean;
  recoveryStatus: RecoveryStatus;
  internalNotes: string | null;
  audioUrl: string | null;
  humanRecordingUrl: string | null;
  callHistory: CallHistoryRow[];
}

export interface CallMetrics {
  totalCalls: number;
  bookedRate: number | null;
  avgDurationSecs: number | null;
  callsPerDay: { date: string; count: number }[];
  emergencyTransferRate: number;
  totalDurationSecs: number;
  aiOnlyDurationSecs: number;
  forwardedDurationSecs: number;
  forwardedCallCount: number;
  durationSecsPerDay: { date: string; durationSecs: number }[];
}

export interface ServiceCategory {
  name: string;
  businessUnitId: string;
  jobTypeId: string;
}

export interface BusinessInfoSettings {
  name: string;
  serviceTitanBusinessUnitId: string;
  serviceTitanCampaignId: string;
  serviceTitanJobTypeId: string;
  serviceCategories: ServiceCategory[];
}

// Voice selection only — no stability/speed/similarity/style/speaker-boost
// (removed 2026-07-20: even with settings synced exactly, Test Audio never
// sounded the same as ElevenLabs' own dashboard, so the app no longer
// adjusts any of these — see elevenlabs/agents.ts's AgentVoiceConfig).
export interface AgentVoiceConfig {
  voiceId: string;
  // Only sent when voiceId came from the Explore tab — see schemas.ts's
  // voiceConfigSchema for why this is required before ElevenLabs will
  // accept the voiceId at all.
  addFromExplore?: { publicOwnerId: string; name: string };
}

export interface VoiceSummary {
  voiceId: string;
  name: string;
  category: string;
  previewUrl: string | null;
  labels: Record<string, string>;
  // Set only for an Explore (shared-library) result, null for My Voices.
  publicOwnerId: string | null;
}

export interface VoiceSettingsResponse {
  voiceConfig: AgentVoiceConfig | null;
  currentVoice: VoiceSummary | null;
}

export interface VoicesSearchResponse {
  voices: VoiceSummary[];
  hasMore: boolean;
}

// The shared knowledge base. This app stores the canonical text (whatever the
// original source), the chat widget retrieves from it, and a copy is pushed to
// ElevenLabs for the voice agent. See docs/knowledge-base.md.
export type KnowledgeSourceType = "text" | "url" | "file";

// Whether the ElevenLabs push succeeded. "not_configured" is a normal outcome,
// not a failure — a chat-only business has no voice agent to sync to.
export type VoiceSyncResult = "synced" | "not_configured" | "failed";

export interface KnowledgeDocumentSummary {
  id: number;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceRef: string | null;
  chunkCount: number;
  syncedToVoice: boolean;
  syncedAt: string | null;
  updatedAt: string;
}

// The list endpoint omits content (documents can be long); this is what
// GET /knowledge-base/:id adds for editing.
export interface KnowledgeDocumentDetail extends KnowledgeDocumentSummary {
  content: string;
}

export interface KnowledgeDocumentListResponse {
  documents: KnowledgeDocumentSummary[];
}

// Returned by the extract-url / extract-file endpoints for the operator to
// review and edit before anything is stored.
export interface ExtractedContent {
  title: string;
  content: string;
  sourceRef: string;
  truncated: boolean;
}

export interface GeneralSettings {
  elevenLabs: { apiKeySet: boolean; agentId: string };
  serviceTitan: {
    environment: "integration" | "production";
    clientIdSet: boolean;
    clientSecretSet: boolean;
    appKeySet: boolean;
    tenantId: string;
    businessUnitId: string;
    campaignId: string;
    callReasonId: string;
    jobTypeId: string;
    tagName: string;
    bookingMode: "lead" | "job";
    serviceCategories: ServiceCategory[];
  };
  operational: {
    toolWebhookSecretSet: boolean;
    postCallWebhookSecretSet: boolean;
    timezone: string;
    dashboardBaseUrl: string;
    twilioPhoneNumber: string;
    leadIntakeWebhookSecretSet: boolean;
    googleLeadFormWebhookSecretSet: boolean;
    dynamicMemoryEnabled: boolean;
    catchAllLeadNotifyEnabled: boolean;
    catchAllLeadNotifyEmail: string;
    catchAllLeadNotifyCc: string;
  };
  googleAds: {
    customerId: string;
    refreshTokenSet: boolean;
  };
}

// Website chat widget config (see src/chat/* and src/widget/*). embedKey is
// public (it ships in the client-site snippet), so it's returned in the clear;
// the Anthropic key is only ever reported set/unset, never echoed back.
export interface ChatWidgetSettings {
  enabled: boolean;
  embedKey: string;
  anthropicApiKeySet: boolean;
  allowedOrigins: string[];
  model: string;
  agentName: string;
  accentColor: string;
  greeting: string;
  logoUrl: string;
  tagline: string;
  quickPrompts: string[];
  systemPromptExtras: string;
  // Email alerts for widget-generated requests (booked jobs + forwarded leads).
  notifyEnabled: boolean;
  notifyEmail: string;
  notifyCc: string;
  // Where the standalone chat-widget service is hosted (global; set in Admin
  // Settings). The install snippet points here. Empty until configured.
  widgetServiceBaseUrl: string;
}

// Global config for the standalone chat-widget service (separate repo) —
// managed in the global Admin Settings, like Twilio/Google-Ads.
export interface WidgetServiceSettings {
  apiSecretSet: boolean;
  baseUrl: string;
  // The operator's own "Powered by" attribution shown in every widget footer.
  name: string;
  url: string;
}

// The OAuth Client ID/Secret + Developer Token this platform's Google Ads
// API access is registered under — global (see settings/store.ts's
// getGoogleAdsPlatformConfig), managed from AdminSettingsPage.tsx's global
// Admin Settings rather than any one business's General Settings.
export interface GoogleAdsSettings {
  developerTokenSet: boolean;
  clientIdSet: boolean;
  clientSecretSet: boolean;
  // The Manager (MCC) account's Customer ID the Developer Token above is
  // issued under — not a secret, shown in plain text like a business's own
  // googleAds.customerId.
  loginCustomerId: string;
}

// "Lead" already means a ServiceTitan CRM Lead elsewhere in this app (the
// Lead/Job links on the Calls pages) — these are a distinct concept, raw
// inbound inquiries from a business's own lead sources, tracked in their
// own inbox. See docs/leads-inbox.md.
export type LeadSource = "website_form" | "website_chat" | "facebook_ads" | "google_ads" | "google_lsa" | "voice_agent";
// Plain string, not a literal union — same reasoning as CallDetail's own
// callReason/callReasonOverride fields. The real valid set (see lib/
// format.ts's LEAD_STATUS_GROUPS) is large (~40 values, mirroring Call
// Reason's own taxonomy) and existing leads may still hold a retired value
// from before that change (new/contacted/qualified/won/lost); a strict
// union would either have to include those forever or make old data
// impossible to type, so this stays a plain string and label/color lookup
// falls back gracefully for anything outside the known set.
export type LeadStatus = string;

export interface InboundLeadListRow {
  id: number;
  source: LeadSource;
  // A sub-classification within source, currently only populated for
  // google_lsa (the real Google lead_type, "PHONE_CALL"/"MESSAGE") — null
  // for every other source. See docs/google-lsa-leads.md.
  sourceDetail: string | null;
  receivedAt: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  message: string | null;
  status: LeadStatus;
  isRead: boolean;
}

export interface InboundLeadDetail extends InboundLeadListRow {
  internalNotes: string | null;
  // Every field this lead's source actually submitted, formatted as plain
  // "Key: Value" lines — always present, regardless of whether this app's
  // own field-matching (name/phone/email/message) mapped things cleanly.
  // See docs/leads-inbox.md.
  rawDump: string;
  // True only for a Google LSA PHONE_CALL lead with a real recording URL
  // captured at ingestion — see GET /leads/:id/recording (businessRouter.ts)
  // and googleLsa/recordings.ts for why this can't just be a plain <audio>
  // src pointed at Google's own URL directly.
  hasRecording: boolean;
  // Number of MessageDetails.attachment_urls found across this lead's
  // conversations (photos/files sent via SMS or email in a Google LSA
  // MESSAGE-type lead) — 0 for everything else. Each is fetched individually
  // via GET /leads/:id/attachments/:index, indices 0..attachmentCount-1.
  attachmentCount: number;
  // Which fallback (if either) resolved a Google LSA phone-call lead's name
  // — "servicetitan" is a real matched customer record, "caller_id" is only
  // ever a best-effort Twilio CNAM guess. Null when the name came straight
  // from Google (a MESSAGE lead) or when nothing resolved a name at all.
  nameSource: LeadNameSource;
}

export type LeadNameSource = "servicetitan" | "caller_id" | null;

export interface LeadListFilters {
  source?: LeadSource;
  status?: LeadStatus;
  isRead?: boolean;
  from?: string;
  to?: string;
}

// The single master Twilio account this platform manages — global (see
// settings/store.ts's getTwilioConfig), managed from AdminSettingsPage.tsx's
// global Admin Settings rather than any one business's General Settings.
export interface TwilioSettings {
  accountSidSet: boolean;
  authTokenSet: boolean;
}

export interface CallListFilters {
  failedTransfer: boolean;
  noBookingCreated: boolean;
  endedEarly: boolean;
  from?: string;
  to?: string;
  isRead?: boolean;
  recoveryStatus?: "recovered" | "not_recovered" | "null";
  status?: CallStatus;
}

// Powers AppShell.tsx's sidebar unread badges — see GET /unread-counts in
// businessRouter.ts.
export interface UnreadCounts {
  calls: number;
  leads: number;
}
