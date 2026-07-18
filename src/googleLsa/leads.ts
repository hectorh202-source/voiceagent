import type { GoogleLsaConfig } from "../settings/store";
import { gaqlSearch } from "./httpClient";

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
    messageDetails?: { text?: string };
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

export async function fetchRecentLsaLeads(config: GoogleLsaConfig): Promise<LsaLeadResult[]> {
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

  const results: LsaLeadResult[] = [];
  for (const row of leadRows) {
    const lead = row.localServicesLead;
    if (!lead?.resourceName) continue;
    const conversations = conversationsByLead.get(lead.resourceName) ?? [];

    results.push({
      externalId: lead.resourceName,
      sourceDetail: lead.leadType ?? null,
      name: lead.contactDetails?.consumerName ?? null,
      phone: lead.contactDetails?.phoneNumber ?? null,
      email: lead.contactDetails?.email ?? null,
      message: buildMessage(lead, conversations),
      // Always the full retrieved data, regardless of how the mapping above
      // went — same "store everything, map best-effort" precedent as the
      // generic webhook's raw_payload_json.
      rawPayloadJson: JSON.stringify({ lead, conversations }),
    });
  }
  return results;
}
