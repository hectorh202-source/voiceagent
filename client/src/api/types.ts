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
}

export interface VoiceSummary {
  voiceId: string;
  name: string;
  category: string;
  previewUrl: string | null;
  labels: Record<string, string>;
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
  };
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
