import { getCallRecord } from "../db/callRecords";
import { findCreateLeadLogByConversationId } from "../db/callLog";

interface TranscriptTurn {
  role: string;
  message?: string;
  time_in_call_secs?: number;
  tool_calls?: Array<{ name?: string; params?: Record<string, unknown>; parameters?: Record<string, unknown> }>;
}

export interface CallDetailViewModel {
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
  summary: string | null;
  transcript: { role: string; message: string; timeLabel: string }[];
  terminationReason: string | null;
  hasAudio: boolean;
}

const COMPANY_NAME = "TitanZ Plumbing and Air Conditioning";

function formatTime(secs: number | undefined): string {
  if (secs === undefined || !Number.isFinite(secs)) return "";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// The exact shape of a transfer_to_number invocation inside the transcript
// isn't documented by ElevenLabs — this is a best-effort parse, not a
// guaranteed-correct one. Adjust once a real payload has been inspected.
function findTransferInfo(turns: TranscriptTurn[]): {
  isTransferred: boolean;
  forwardedNumber: string | null;
  transferDestination: string | null;
} {
  for (const turn of turns) {
    for (const call of turn.tool_calls ?? []) {
      const name = (call.name ?? "").toLowerCase();
      if (name.includes("transfer")) {
        const params = call.params ?? call.parameters ?? {};
        const forwardedNumber =
          (params.phone_number as string | undefined) ??
          (params.phoneNumber as string | undefined) ??
          (params.destination as string | undefined) ??
          null;
        return { isTransferred: true, forwardedNumber, transferDestination: forwardedNumber };
      }
    }
  }
  return { isTransferred: false, forwardedNumber: null, transferDestination: null };
}

export function buildCallDetailViewModel(conversationId: string): CallDetailViewModel | null {
  const callRecord = getCallRecord(conversationId);
  if (!callRecord) return null;

  const leadLog = findCreateLeadLogByConversationId(conversationId);
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

  const leadUrl = leadId ? `https://go.servicetitan.com/#/Lead/Index/${leadId}` : null;

  let transcript: { role: string; message: string; timeLabel: string }[] = [];
  let transferInfo = { isTransferred: false, forwardedNumber: null as string | null, transferDestination: null as string | null };
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
    conversationId,
    callTime: callRecord.received_at,
    company: COMPANY_NAME,
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
    summary: callRecord.summary,
    transcript,
    terminationReason: callRecord.termination_reason,
    hasAudio: !!callRecord.audio_path,
  };
}
