import type { GoogleLsaConfig } from "../settings/store";
import { gaqlSearch } from "./httpClient";

// Field names below follow Google's publicly documented Local Services Ads
// resources (LocalServicesLead / LocalServicesLeadConversation, Google Ads
// API v18) — NOT yet confirmed against a real payload from a real account
// (see docs/google-lsa-leads.md's Stage 0). If the real shape differs once
// leads start flowing, this is the one file to adjust — same "known gaps,
// adjust once real data is seen" precedent as postCall.ts's
// extractDurationSecs/extractCallReason. Every field access below is
// optional-chained specifically so an unexpected/missing field degrades to
// a blank value rather than throwing and dropping the whole lead.
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
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  rawPayloadJson: string;
}

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

const CONVERSATIONS_QUERY = `
  SELECT
    local_services_lead_conversation.resource_name,
    local_services_lead_conversation.id,
    local_services_lead_conversation.lead,
    local_services_lead_conversation.conversation_channel,
    local_services_lead_conversation.participant_type,
    local_services_lead_conversation.event_date_time,
    local_services_lead_conversation.message_details,
    local_services_lead_conversation.phone_call_details
  FROM local_services_lead_conversation
  ORDER BY local_services_lead_conversation.event_date_time ASC
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
    const callConvo = conversations.find((c) => c.phoneCallDetails);
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

  const results: LsaLeadResult[] = [];
  for (const row of leadRows) {
    const lead = row.localServicesLead;
    if (!lead?.resourceName) continue;
    const conversations = conversationsByLead.get(lead.resourceName) ?? [];

    results.push({
      externalId: lead.resourceName,
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
