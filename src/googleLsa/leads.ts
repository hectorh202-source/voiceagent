import { getServiceTitanConfig } from "../settings/store";
import type { GoogleLsaConfig } from "../settings/store";
import { gaqlSearch } from "./httpClient";
import { lookupCustomerByPhone } from "../servicetitan/customers";
import { lookupCallerName } from "../twilio/callerName";

// Field names confirmed 2026-07-17 against the real Google Ads API v24
// (google.ads.googleads.v24.resources LocalServicesLead /
// LocalServicesLeadConversation proto definitions) — not just guessed at
// from docs. leadType/leadStatus/conversationChannel/participantType enum
// *values* (e.g. "MESSAGE"/"PHONE_CALL") are still unconfirmed against a
// real row, since no real leads existed yet in TitanZ's account at
// verification time — if a real lead's leadType doesn't match the strings
// buildMessage() checks for below, that's the first thing to check. Every
// field access below is optional-chained specifically so an
// unexpected/missing field degrades to a blank value rather than throwing
// and dropping the whole lead.
interface LocalServicesLeadRow {
  localServicesLead?: {
    resourceName?: string;
    id?: string;
    leadType?: string; // "MESSAGE" | "PHONE_CALL" | ...
    leadStatus?: string;
    creationDateTime?: string;
    locale?: string;
    leadCharged?: boolean;
    contactDetails?: {
      consumerName?: string;
      phoneNumber?: string;
      email?: string;
    };
  };
}

interface LocalServicesLeadConversationRow {
  localServicesLeadConversation?: {
    resourceName?: string;
    id?: string;
    lead?: string; // resource name of the parent local_services_lead
    conversationChannel?: string; // "EMAIL" | "MESSAGE" | "PHONE_CALL" | "SMS"
    participantType?: string; // "ADVERTISER" | "CONSUMER"
    eventDateTime?: string;
    // attachmentUrls: real field, confirmed against the official v24 proto
    // (LocalServicesLeadConversation.MessageDetails) — "URL to the SMS or
    // email attachments. These URLs can be used to download the contents of
    // the attachment by using the developer token." No real lead in this
    // account has one populated yet (checked directly, 2026-07-18), so the
    // proxy route built against this (googleLsa/attachments.ts) is unverified
    // end-to-end until a real attachment shows up in a future poll.
    messageDetails?: { text?: string; attachmentUrls?: string[] };
    phoneCallDetails?: { callDurationMillis?: string; callRecordingUrl?: string };
  };
}

export interface LsaLeadResult {
  externalId: string;
  // The real Google lead_type ("PHONE_CALL"/"MESSAGE") — surfaced as its own
  // field (not folded into `message`) so the Leads inbox's Source column can
  // distinguish a Google LSA phone-call lead from a Google LSA message lead,
  // not just show "Google LSA" for both.
  sourceDetail: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  rawPayloadJson: string;
}

// Confirmed via two real GAQL errors (2026-07-17) that GAQL's selectable-
// field catalog is inconsistent about this across resources, not a fixed
// rule: local_services_lead.contact_details IS selectable as a whole
// compound field (confirmed — no error), but
// local_services_lead_conversation.message_details/phone_call_details are
// NOT (PROHIBITED_FIELD_IN_SELECT_CLAUSE) and must be broken into their
// individual leaf sub-fields instead (UNRECOGNIZED_FIELD is what you get if
// you try to do that to a field that's actually fine selected whole, as
// contact_details turned out to be). The REST JSON response nests
// contact_details back under contactDetails, matching the row type below.
const LEADS_QUERY = `
  SELECT
    local_services_lead.resource_name,
    local_services_lead.id,
    local_services_lead.lead_type,
    local_services_lead.lead_status,
    local_services_lead.creation_date_time,
    local_services_lead.locale,
    local_services_lead.lead_charged,
    local_services_lead.contact_details
  FROM local_services_lead
  ORDER BY local_services_lead.creation_date_time DESC
  LIMIT 50
`;

// Confirmed via real data (2026-07-17): this must be DESC, not ASC.
// LEADS_QUERY above fetches the 50 *newest* leads — an ASC-ordered
// conversations query with the same LIMIT instead fetches the account's
// *oldest* conversations, which for an account with any real history never
// overlaps with those 50 recent leads at all (confirmed: a real MESSAGE
// lead came back with an empty conversations array and fell through to the
// generic fallback message, purely because of this ordering mismatch, not
// because the conversation didn't exist). Sorted back to ascending
// per-lead, after grouping, wherever chronological order actually matters
// (see the sort in fetchRecentLsaLeads below).
const CONVERSATIONS_QUERY = `
  SELECT
    local_services_lead_conversation.resource_name,
    local_services_lead_conversation.id,
    local_services_lead_conversation.lead,
    local_services_lead_conversation.conversation_channel,
    local_services_lead_conversation.participant_type,
    local_services_lead_conversation.event_date_time,
    local_services_lead_conversation.message_details.text,
    local_services_lead_conversation.message_details.attachment_urls,
    local_services_lead_conversation.phone_call_details.call_duration_millis,
    local_services_lead_conversation.phone_call_details.call_recording_url
  FROM local_services_lead_conversation
  ORDER BY local_services_lead_conversation.event_date_time DESC
  LIMIT 200
`;

function formatDuration(callDurationMillis: string | undefined): string | null {
  if (!callDurationMillis) return null;
  const seconds = Math.round(Number(callDurationMillis) / 1000);
  if (!Number.isFinite(seconds)) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

// Best-effort message construction, always falling back to a plain
// key/value dump of whatever we actually have rather than dropping the
// lead's content — same "never silently lose data" approach used for the
// generic website-form webhook's leadIntake.ts fallback.
function buildMessage(
  lead: NonNullable<LocalServicesLeadRow["localServicesLead"]>,
  conversations: NonNullable<LocalServicesLeadConversationRow["localServicesLeadConversation"]>[],
): string | null {
  if (lead.leadType === "MESSAGE") {
    const texts = conversations
      .map((c) => c.messageDetails?.text)
      .filter((t): t is string => !!t && t.trim() !== "");
    if (texts.length > 0) return texts.join("\n---\n");
  }

  if (lead.leadType === "PHONE_CALL") {
    // Checking c.phoneCallDetails alone isn't safe — GAQL returns an empty
    // {} object for a selected-but-inapplicable nested field (e.g. a
    // MESSAGE-channel conversation row still has a phoneCallDetails key,
    // just empty), and {} is truthy in JS. Check the actual value instead.
    const callConvo = conversations.find((c) => c.phoneCallDetails?.callDurationMillis);
    const duration = formatDuration(callConvo?.phoneCallDetails?.callDurationMillis);
    const lines = [`Phone call lead${duration ? ` — duration ${duration}` : ""}`];
    if (callConvo?.phoneCallDetails?.callRecordingUrl) {
      lines.push(`Recording: ${callConvo.phoneCallDetails.callRecordingUrl}`);
    }
    return lines.join("\n");
  }

  const fallbackLines: string[] = [];
  if (lead.leadType) fallbackLines.push(`Lead Type: ${lead.leadType}`);
  if (lead.leadStatus) fallbackLines.push(`Lead Status: ${lead.leadStatus}`);
  if (lead.creationDateTime) fallbackLines.push(`Created: ${lead.creationDateTime}`);
  return fallbackLines.length > 0 ? fallbackLines.join("\n") : null;
}

export async function fetchRecentLsaLeads(config: GoogleLsaConfig, businessId: number): Promise<LsaLeadResult[]> {
  const [leadRows, conversationRows] = await Promise.all([
    gaqlSearch<LocalServicesLeadRow>(config, LEADS_QUERY),
    gaqlSearch<LocalServicesLeadConversationRow>(config, CONVERSATIONS_QUERY),
  ]);

  const conversationsByLead = new Map<string, NonNullable<LocalServicesLeadConversationRow["localServicesLeadConversation"]>[]>();
  for (const row of conversationRows) {
    const convo = row.localServicesLeadConversation;
    if (!convo?.lead) continue;
    const existing = conversationsByLead.get(convo.lead) ?? [];
    existing.push(convo);
    conversationsByLead.set(convo.lead, existing);
  }
  // CONVERSATIONS_QUERY is DESC overall (see its comment) so the per-lead
  // groups above come out newest-first — re-sort each group back to
  // ascending so a multi-message MESSAGE thread reads in the order it was
  // actually sent, oldest first.
  for (const convos of conversationsByLead.values()) {
    convos.sort((a, b) => (a.eventDateTime ?? "").localeCompare(b.eventDateTime ?? ""));
  }

  // Checked once per call, not once per lead — a business with no
  // ServiceTitan configured should never even attempt a lookup, and this is
  // the one config check that's the same for every lead in this batch.
  const serviceTitanConfigured = getServiceTitanConfig(businessId) !== null;

  const results: LsaLeadResult[] = [];
  for (const row of leadRows) {
    const lead = row.localServicesLead;
    if (!lead?.resourceName) continue;
    const conversations = conversationsByLead.get(lead.resourceName) ?? [];

    const phone = lead.contactDetails?.phoneNumber ?? null;
    let name = lead.contactDetails?.consumerName ?? null;
    let email = lead.contactDetails?.email ?? null;
    // Which fallback (if either) actually supplied `name` — surfaced in the
    // UI (see googleLsa/nameSource.ts) so staff can see a ServiceTitan CRM
    // match is a real customer record, while a Caller ID result is only ever
    // a best-effort phone-carrier guess. Left null when Google's own
    // contactDetails.consumerName already had it (MESSAGE leads) or when
    // nothing resolved a name at all.
    let nameSource: "servicetitan" | "caller_id" | null = null;

    // Google's API never returns a caller name or email for a PHONE_CALL
    // lead — confirmed against real data (2026-07-18): contactDetails only
    // ever has phoneNumber for that lead type, and there's no transcript
    // field to extract either from. Two fallback sources are tried in
    // order, cheapest/most-authoritative first:
    //   1. This business's own ServiceTitan CRM, if the caller already
    //      exists there by phone number (same lookup createLead.ts already
    //      uses for AI-handled calls; it fetches email alongside name in one
    //      request, so both are backfilled for the cost of one lookup).
    //   2. Twilio's Caller ID (CNAM) lookup, name-only — a real phone
    //      carrier record rather than this app's own data, so it's tried
    //      whenever ServiceTitan didn't resolve a name. Known to be
    //      unreliable for mobile numbers specifically (many carriers don't
    //      populate CNAM), so this is a last-resort, not authoritative.
    // A caller that neither source resolves genuinely has no name/email
    // available from anywhere this app can reach, and keeps showing
    // "Unknown" / a blank email.
    //
    // Runs on every 5-minute poll for every PHONE_CALL lead still missing
    // either field, in the last 50 (insertInboundLead's upsert means a later
    // match correctly backfills a lead that had neither before) — an
    // accepted, unbounded-retry tradeoff at today's lead volume; revisit if
    // this ever grows enough to strain ServiceTitan's rate limits or run up
    // Twilio's per-lookup CNAM cost.
    if ((!name || !email) && lead.leadType === "PHONE_CALL" && phone && serviceTitanConfigured) {
      try {
        const match = await lookupCustomerByPhone(businessId, phone);
        if (match.found) {
          if (!name && match.name) {
            name = match.name;
            nameSource = "servicetitan";
          }
          if (!email && match.email) email = match.email;
        }
      } catch {
        // Best-effort — a transient ServiceTitan failure just leaves this
        // lead as it was, same as if it had no match at all.
      }
    }
    if (!name && lead.leadType === "PHONE_CALL" && phone) {
      try {
        const callerName = await lookupCallerName(phone);
        if (callerName) {
          name = callerName;
          nameSource = "caller_id";
        }
      } catch {
        // Best-effort — lookupCallerName already swallows its own errors
        // and returns null, but this guards against any future change to
        // that contract.
      }
    }

    results.push({
      externalId: lead.resourceName,
      sourceDetail: lead.leadType ?? null,
      name,
      phone,
      email,
      message: buildMessage(lead, conversations),
      // Always the full retrieved data, regardless of how the mapping above
      // went — same "store everything, map best-effort" precedent as the
      // generic webhook's raw_payload_json. nameSource rides along here
      // (not a real Google field) rather than getting its own DB column —
      // see googleLsa/nameSource.ts's extractNameSource, same "encode it in
      // the already-stored payload, extract at read time" pattern as
      // hasRecording/attachmentCount.
      rawPayloadJson: JSON.stringify({ lead, conversations, nameSource }),
    });
  }
  return results;
}
