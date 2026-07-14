export interface SessionUser {
  id: number;
  email: string;
}

export interface Business {
  id: number;
  name: string;
  createdAt: string;
}

export type CallStatus = "booked" | "not_booked" | "excused";
export type CallHandler = "ai" | "ai_human";
export type RecoveryStatus = "recovered" | "not_recovered" | null;

export interface CallFlags {
  failedTransfer: boolean;
  noBookingCreated: boolean;
  endedEarly: boolean;
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
  callReason: string | null;
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
  durationSecs: number | null;
  callReason: string | null;
  isRead: boolean;
  recoveryStatus: RecoveryStatus;
  audioUrl: string | null;
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
