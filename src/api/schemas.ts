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
  leadIntakeWebhookSecret: z.string().optional(),
  googleAdsCustomerId: z.string().optional(),
  googleAdsRefreshToken: z.string().optional(),
  dynamicMemoryEnabled: z.boolean().optional(),
});

// The OAuth Client ID/Secret and Developer Token this platform's Google Ads
// API access is registered under — global, not per-business (see
// settings/store.ts's getGoogleLsaConfig for why: one registered OAuth "app
// identity" can mint tokens against many separate businesses' own accounts,
// so unlike ServiceTitan's per-business client id/secret, these are shared
// infrastructure the platform operator registers once). Each business's own
// refreshToken/customerId (googleAdsRefreshToken/googleAdsCustomerId above)
// stay per-business, since each business's Google Ads account is genuinely
// separate.
export const googleAdsSettingsSchema = z.object({
  developerToken: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  loginCustomerId: z.string().optional(),
});

// "Lead" already means a ServiceTitan CRM Lead elsewhere in this codebase
// (servicetitan/leads.ts, tools/createLead.ts) — these are a distinct
// concept, raw inbound inquiries from a business's own lead sources, tracked
// in their own inbox and never auto-pushed to ServiceTitan.
// facebook_ads/google_ads (a Lead Form Extension submission — a different
// Google product from Local Services Ads, still deferred, not yet built)
// exist here so the DB/API already accommodate them once that ingestion is
// built. google_lsa (Google Local Services Ads — MESSAGE/PHONE_CALL leads,
// see docs/google-lsa-leads.md) is written directly via insertInboundLead()
// by src/googleLsa/pollLeads.ts, not through the generic webhook —
// leadIntakeSchema below deliberately only accepts the two sources that
// webhook actually handles.
export const LEAD_SOURCE_VALUES = ["website_form", "website_chat", "facebook_ads", "google_ads", "google_lsa"] as const;
// Mirrors CallDetailPage.tsx's CALL_REASON_GROUPS taxonomy (client-side),
// minus the "Outbound" group — leads are always inbound, so those options
// don't apply. Replaced the original flat new/contacted/qualified/won/lost
// set so a lead's status can capture the same specific detail Call Reason
// already does for calls, grouped under the same category names for a
// consistent per-category color scheme (see lib/format.ts's
// LEAD_STATUS_GROUPS/getLeadStatusColors on the client).
//
// Existing rows already set to a retired value (contacted/qualified/won/
// lost) are deliberately left as-is in the DB — this enum only governs what
// a *new* PATCH can set going forward (status is unconstrained TEXT with no
// SQL CHECK constraint, see docs/leads-inbox.md), so old data isn't touched
// or migrated; a business re-triages an old lead manually by picking a real
// category next time they open it.
export const LEAD_STATUS_VALUES = [
  "new",
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
  "Other",
] as const;

// Deliberately no "at least one of name/phone/email required" check, and no
// `.email()` format validation on email — a submission is never rejected
// just because this app's field-matching came up empty or matched
// something odd-shaped; the whole point of leadIntake.ts's fuzzy matching +
// raw-dump fallback is that every real form submission gets stored no
// matter how its fields are labeled, even if that means some fields land in
// `message` instead of their own column.
export const leadIntakeSchema = z.object({
  source: z.enum(["website_form", "website_chat"]),
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  message: z.string().optional(),
  externalId: z.string().optional(),
});

export const patchLeadsSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  isRead: z.boolean().optional(),
  status: z.enum(LEAD_STATUS_VALUES).optional(),
  internalNotes: z.string().nullable().optional(),
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

export const kbTextSchema = z.object({
  text: z.string().min(1),
  name: z.string().optional(),
});

export const kbUrlSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
});

// Sent by the client alongside the document id in the URL when attaching —
// the agent's knowledge_base array entry needs a name/type, and the client
// already has both from the list view it's attaching from, so there's no
// need for the server to re-fetch the document just to attach it.
export const kbAttachSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["file", "url", "text", "folder"]),
});
