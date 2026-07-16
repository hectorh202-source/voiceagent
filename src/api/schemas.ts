import { z } from "zod";

// The fixed set of values the Call Reason override dropdown offers (see
// client/src/pages/CallDetailPage.tsx's CALL_REASON_GROUPS, which must stay
// in sync with this list). The *auto* call_reason column isn't validated
// against this — it's free text from ElevenLabs' own Data Collection field —
// but a manual override is always one of these, since it's chosen from this
// exact fixed dropdown.
export const CALL_REASON_OVERRIDE_VALUES = [
  "Booked - Repair",
  "Booked - Maintenance",
  "Booked - Sales/Estimate",
  "Booked - Service",
  "Follow Up - Cancel",
  "Follow Up - Membership Cancel",
  "Follow Up - ETA",
  "Follow Up - Reschedule",
  "Follow Up - Other Update",
  "Follow Up - Complaint",
  "Follow Up - Compliment",
  "Follow Up - Invoice/Payment",
  "Follow Up - Confirming Time",
  "Excused - Test Call",
  "Excused - Outside of Area",
  "Excused - Outside of Services",
  "Excused - Telemarketing",
  "Excused - Spam",
  "Excused - Internal Call",
  "Excused - Employment",
  "Excused - Update Profile",
  "Excused - Other Questions",
  "Excused - No Reason",
  "Excused - Silent Call",
  "Excused - Not Homeowner",
  "Excused - Installation Call",
  "Excused - Live Agent Request",
  "Excused - Transfer to Specific Person",
  "Excused - Membership Inquiry",
  "Excused - Installation Pictures",
  "Excused - Returning Call",
  "Unbooked - Reject Agent",
  "Unbooked - Time Concern",
  "Unbooked - Price Concern",
  "Unbooked - Call Back Later",
  "Unbooked - Trip Charge",
  "Unbooked - Commercial",
  "Unbooked - Pending Coordination",
  "Unbooked - Callback (Previous Job)",
  "Outbound - Voicemail",
  "Outbound - Not Interested",
  "Outbound - Not Available",
  "Outbound - Disconnected",
  "Outbound - Moved",
  "Outbound - Do Not Call",
] as const;

export const patchCallsSchema = z.object({
  conversationIds: z.array(z.string().min(1)).min(1),
  isRead: z.boolean().optional(),
  recoveryStatus: z.enum(["recovered", "not_recovered"]).nullable().optional(),
  statusOverride: z.enum(["booked", "not_booked", "excused"]).nullable().optional(),
  callReasonOverride: z.enum(CALL_REASON_OVERRIDE_VALUES).nullable().optional(),
  internalNotes: z.string().nullable().optional(),
});

export const businessInfoSchema = z.object({
  name: z.string().min(1).optional(),
  serviceTitanBusinessUnitId: z.string().optional(),
  serviceTitanCampaignId: z.string().optional(),
  serviceTitanJobTypeId: z.string().optional(),
  serviceCategories: z
    .array(
      z.object({
        name: z.string(),
        businessUnitId: z.string(),
        jobTypeId: z.string(),
      }),
    )
    .optional(),
});

export const emailSettingsSchema = z.object({
  smtpHost: z.string().optional(),
  smtpPort: z.string().optional(),
  smtpSecure: z.boolean().optional(),
  smtpUsername: z.string().optional(),
  smtpPassword: z.string().optional(),
  fromAddress: z.string().optional(),
  fromName: z.string().optional(),
});

export const testEmailSchema = z.object({
  to: z.string().trim().toLowerCase().email(),
});

export const generalSettingsSchema = z.object({
  elevenLabsApiKey: z.string().optional(),
  elevenLabsAgentId: z.string().optional(),
  serviceTitanEnvironment: z.enum(["integration", "production"]).optional(),
  serviceTitanClientId: z.string().optional(),
  serviceTitanClientSecret: z.string().optional(),
  serviceTitanAppKey: z.string().optional(),
  serviceTitanTenantId: z.string().optional(),
  serviceTitanCallReasonId: z.string().optional(),
  serviceTitanTagName: z.string().optional(),
  serviceTitanBookingMode: z.enum(["lead", "job"]).optional(),
  timezone: z.string().optional(),
  dashboardBaseUrl: z.string().optional(),
  toolWebhookSecret: z.string().optional(),
  postCallWebhookSecret: z.string().optional(),
  twilioPhoneNumber: z.string().optional(),
});

// The master Twilio account this platform manages — global, not per-business
// (see settings/store.ts's getTwilioConfig for why), so this is submitted
// from AdminSettingsPage.tsx's global Admin Settings rather than each
// business's own General Settings.
export const twilioSettingsSchema = z.object({
  accountSid: z.string().optional(),
  authToken: z.string().optional(),
});

// Mirrors elevenlabs/agents.ts's TTS_MODEL_IDS exactly — kept as a literal
// tuple here (rather than importing it) since schemas.ts is shared by every
// API route and shouldn't pull in the ElevenLabs client module just for an
// enum; the two lists must be kept in sync if ElevenLabs adds a new model.
export const voiceConfigSchema = z.object({
  modelId: z.enum(["eleven_turbo_v2", "eleven_turbo_v2_5", "eleven_flash_v2", "eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_v3_conversational"]),
  voiceId: z.string().min(1),
  stability: z.number().min(0).max(1),
  speed: z.number(),
  similarityBoost: z.number().min(0).max(1),
  // Present only when voiceId came from the Explore tab (ElevenLabs' full
  // shared-voice library) rather than this account's own saved voices —
  // confirmed setting voiceId directly without adding it first fails with
  // a 400 voice_not_found, so the server adds it to the account before
  // setting it on the agent. Omitted entirely for a My Voices selection.
  addFromExplore: z
    .object({
      publicOwnerId: z.string().min(1),
      name: z.string().min(1),
    })
    .optional(),
});
