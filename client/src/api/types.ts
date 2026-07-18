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

// Mirrors elevenlabs/agents.ts's TTS_MODEL_IDS exactly.
export type TtsModelId =
  | "eleven_turbo_v2"
  | "eleven_turbo_v2_5"
  | "eleven_flash_v2"
  | "eleven_flash_v2_5"
  | "eleven_multilingual_v2"
  | "eleven_v3_conversational";

export interface AgentVoiceConfig {
  modelId: TtsModelId;
  voiceId: string;
  stability: number;
  speed: number;
  similarityBoost: number;
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
  availableModels: TtsModelId[];
}

export interface VoicesSearchResponse {
  voices: VoiceSummary[];
  hasMore: boolean;
}

export type KnowledgeBaseDocumentType = "file" | "url" | "text" | "folder";

export interface KnowledgeBaseDocument {
  id: string;
  name: string;
  type: KnowledgeBaseDocumentType;
  createdAtUnixSecs: number | null;
  updatedAtUnixSecs: number | null;
  sizeBytes: number | null;
  // Whether this document is currently referenced in this business's own
  // agent's conversation_config.agent.prompt.knowledge_base array — not an
  // ElevenLabs field, computed server-side by cross-referencing the
  // account-wide document list against that one array.
  attached: boolean;
}

export interface KnowledgeBaseListResponse {
  documents: KnowledgeBaseDocument[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface KnowledgeBaseDependentAgent {
  type: "available" | "unknown";
  id?: string;
  name?: string;
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
    dynamicMemoryEnabled: boolean;
  };
  googleAds: {
    customerId: string;
    refreshTokenSet: boolean;
  };
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
export type LeadSource = "website_form" | "website_chat" | "facebook_ads" | "google_ads" | "google_lsa";
export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";

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
}

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
