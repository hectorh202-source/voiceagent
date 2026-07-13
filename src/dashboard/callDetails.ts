import { getCallRecord } from "../db/callRecords";
import type { ElevenLabsCallRecord } from "../db/callRecords";
import { findCreateLeadLogByConversationId } from "../db/callLog";
import { getRawServiceTitanSettings } from "../settings/store";
import type { Business } from "../db/businesses";

// ServiceTitan's web UI hostname differs by environment: the integration/
// sandbox tenant lives under integration.servicetitan.com, while production
// tenants use go.servicetitan.com — confirmed by hitting a real sandbox lead.
const ST_WEB_HOSTS: Record<string, string> = {
  integration: "integration.servicetitan.com",
  production: "go.servicetitan.com",
};

interface TranscriptTurn {
  role: string;
  message?: string;
  time_in_call_secs?: number;
  tool_calls?: Array<{ tool_name?: string; params_as_json?: string }>;
  tool_results?: Array<{ tool_name?: string; is_error?: boolean }>;
}

export interface CallDetailViewModel {
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
  isTransferred: boolean;
  forwardedNumber: string | null;
  transferDestination: string | null;
  transferFailed: boolean;
  summary: string | null;
  transcript: { role: string; message: string; timeLabel: string }[];
  terminationReason: string | null;
  hasAudio: boolean;
}

function formatTime(secs: number | undefined): string {
  if (secs === undefined || !Number.isFinite(secs)) return "";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Confirmed against a real transcript (the Emergency Dispatch burning-smell
// test call): ElevenLabs' actual tool_calls entries use `tool_name` and a
// JSON-encoded `params_as_json` string — not `name`/`params`/`parameters` as
// an earlier version of this guessed, which meant it never matched anything
// real. Only `transfer_to_number` is a genuine human/phone transfer; the
// `transfer_to_agent` calls elsewhere in a multi-agent transcript are just
// internal node-to-node routing and always report success — they must not
// be confused with this.
function findTransferInfo(turns: TranscriptTurn[]): {
  isTransferred: boolean;
  forwardedNumber: string | null;
  transferDestination: string | null;
  transferFailed: boolean;
} {
  for (const turn of turns) {
    for (const call of turn.tool_calls ?? []) {
      if (call.tool_name !== "transfer_to_number") continue;
      let forwardedNumber: string | null = null;
      try {
        const params = JSON.parse(call.params_as_json ?? "{}") as { transfer_number?: string };
        forwardedNumber = params.transfer_number ?? null;
      } catch {
        // leave null rather than crash on an unexpected params shape
      }
      const transferFailed = turns.some((t) =>
        (t.tool_results ?? []).some((r) => r.tool_name === "transfer_to_number" && r.is_error),
      );
      return { isTransferred: true, forwardedNumber, transferDestination: forwardedNumber, transferFailed };
    }
  }
  return { isTransferred: false, forwardedNumber: null, transferDestination: null, transferFailed: false };
}

export function buildCallDetailViewModel(business: Business, conversationId: string): CallDetailViewModel | null {
  const callRecord = getCallRecord(business.id, conversationId);
  if (!callRecord) return null;

  const leadLog = findCreateLeadLogByConversationId(business.id, conversationId);
  let customerName: string | null = null;
  let phone: string | null = null;
  let address: string | null = null;
  let isEmergency: boolean | null = null;
  let leadId: string | null = null;

  if (leadLog) {
    try {
      const request = JSON.parse(leadLog.request_json) as {
        name?: string;
        phone?: string;
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
        isEmergency?: boolean;
      };
      customerName = request.name ?? null;
      phone = request.phone ?? null;
      address = [request.street, request.city, request.state, request.zip].filter(Boolean).join(", ") || null;
      isEmergency = request.isEmergency ?? null;
    } catch {
      // stored request_json should always be valid JSON (we wrote it), but don't let a
      // corrupt row crash the page
    }
    if (leadLog.response_json) {
      try {
        const response = JSON.parse(leadLog.response_json) as { leadId?: string | null };
        leadId = response.leadId ?? null;
      } catch {
        // same as above
      }
    }
  }

  const stEnvironment = getRawServiceTitanSettings(business.id).environment;
  const stWebHost = ST_WEB_HOSTS[stEnvironment] ?? ST_WEB_HOSTS.production;
  const leadUrl = leadId ? `https://${stWebHost}/#/Lead/Index/${leadId}` : null;

  let transcript: { role: string; message: string; timeLabel: string }[] = [];
  let transferInfo = {
    isTransferred: false,
    forwardedNumber: null as string | null,
    transferDestination: null as string | null,
    transferFailed: false,
  };
  if (callRecord.transcript_json) {
    try {
      const turns = JSON.parse(callRecord.transcript_json) as TranscriptTurn[];
      transcript = turns
        .filter((t) => t.message)
        .map((t) => ({ role: t.role, message: t.message ?? "", timeLabel: formatTime(t.time_in_call_secs) }));
      transferInfo = findTransferInfo(turns);
    } catch {
      // malformed/unexpected transcript shape — show no transcript rather than crash
    }
  }

  return {
    businessId: business.id,
    conversationId,
    callTime: callRecord.received_at,
    company: business.name,
    customerName,
    phone,
    address,
    email: "N/A",
    propertyType: "Residential",
    isEmergency,
    leadId,
    leadUrl,
    isTransferred: transferInfo.isTransferred,
    forwardedNumber: transferInfo.forwardedNumber,
    transferDestination: transferInfo.transferDestination,
    transferFailed: transferInfo.transferFailed,
    summary: callRecord.summary,
    transcript,
    terminationReason: callRecord.termination_reason,
    hasAudio: !!callRecord.audio_path,
  };
}

export interface CallFlags {
  failedTransfer: boolean;
  noLeadCreated: boolean;
  endedEarly: boolean;
}

// Surfaces calls worth a human glance, using only data already captured —
// no new AI/ML involved, just deriving signals from the same transcript and
// call_log rows the detail page already reads.
export function computeCallFlags(business: Business, record: ElevenLabsCallRecord): CallFlags {
  let failedTransfer = false;
  let hadRealActivity = false;
  if (record.transcript_json) {
    try {
      const turns = JSON.parse(record.transcript_json) as TranscriptTurn[];
      failedTransfer = turns.some((t) =>
        (t.tool_results ?? []).some((r) => r.tool_name === "transfer_to_number" && r.is_error),
      );
      // Deliberately narrow — a call that hung up before any real activity
      // (e.g. an immediate wrong-number hangup) was never going to produce a
      // lead, so it shouldn't be flagged for missing one.
      hadRealActivity = turns.some((t) => (t.tool_calls ?? []).some((c) => c.tool_name === "lookup_customer"));
    } catch {
      // malformed/unexpected transcript shape — leave flags false rather than crash
    }
  }

  const noLeadCreated = hadRealActivity && !findCreateLeadLogByConversationId(business.id, record.conversation_id);
  const endedEarly = record.termination_reason === "Call ended by remote party";

  return { failedTransfer, noLeadCreated, endedEarly };
}
