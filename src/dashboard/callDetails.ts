import { getCallRecord, listCallRecordsByPhone } from "../db/callRecords";
import type { ElevenLabsCallRecord } from "../db/callRecords";
import { findCreateLeadLogByConversationId, findBookJobLogByConversationId } from "../db/callLog";
import type { CreateLeadLogRow } from "../db/callLog";
import { getRawServiceTitanSettings } from "../settings/store";
import type { Business } from "../db/businesses";

// ServiceTitan's web UI hostname differs by environment: the integration/
// sandbox tenant lives under integration.servicetitan.com, while production
// tenants use go.servicetitan.com — confirmed by hitting a real sandbox lead.
const ST_WEB_HOSTS: Record<string, string> = {
  integration: "integration.servicetitan.com",
  production: "go.servicetitan.com",
};

// Shared by buildCallDetailViewModel and the calls-list API (businessRouter.ts)
// so both surfaces link to the exact same ServiceTitan record — jobUrl's
// pattern is assumed to mirror the Lead URL convention (unconfirmed until
// verified against one real booked job, same as the Lead URL originally was).
export function buildServiceTitanUrls(
  businessId: number,
  leadId: string | null,
  jobId: string | null,
): { leadUrl: string | null; jobUrl: string | null } {
  const stEnvironment = getRawServiceTitanSettings(businessId).environment;
  const stWebHost = ST_WEB_HOSTS[stEnvironment] ?? ST_WEB_HOSTS.production;
  return {
    leadUrl: leadId ? `https://${stWebHost}/#/Lead/Index/${leadId}` : null,
    jobUrl: jobId ? `https://${stWebHost}/#/Job/Index/${jobId}` : null,
  };
}

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
  callReason: string | null;
  autoCallReason: string | null;
  callReasonOverride: string | null;
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

  // A call only ever produces a Lead or a Job, never both (book_job's own
  // emergency safety net logs itself as create_lead) — check the lead log
  // first since it's the far more common case today, falling back to the
  // job log only if no lead was found.
  const leadLog = findCreateLeadLogByConversationId(business.id, conversationId);
  const jobLog = leadLog ? undefined : findBookJobLogByConversationId(business.id, conversationId);
  const bookingLog = leadLog ?? jobLog;

  let customerName: string | null = null;
  let phone: string | null = null;
  let address: string | null = null;
  let isEmergency: boolean | null = null;
  let leadId: string | null = null;
  let jobId: string | null = null;

  if (bookingLog) {
    try {
      const request = JSON.parse(bookingLog.request_json) as {
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
    if (bookingLog.response_json) {
      try {
        const response = JSON.parse(bookingLog.response_json) as { leadId?: string | null; jobId?: string | null };
        leadId = response.leadId ?? null;
        jobId = response.jobId ?? null;
      } catch {
        // same as above
      }
    }
  }

  const { leadUrl, jobUrl } = buildServiceTitanUrls(business.id, leadId, jobId);
  const autoStatus = deriveStatus(leadLog, jobLog);
  const statusOverride = (callRecord.status_override as CallStatus | null) ?? null;
  const status = statusOverride ?? autoStatus;
  const autoCallReason = callRecord.call_reason;
  const callReasonOverride = callRecord.call_reason_override;
  const callReason = callReasonOverride ?? autoCallReason;

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
    jobId,
    jobUrl,
    isTransferred: transferInfo.isTransferred,
    forwardedNumber: transferInfo.forwardedNumber,
    transferDestination: transferInfo.transferDestination,
    transferFailed: transferInfo.transferFailed,
    summary: callRecord.summary,
    transcript,
    terminationReason: callRecord.termination_reason,
    hasAudio: !!callRecord.audio_path,
    status,
    autoStatus,
    statusOverride,
    callReason,
    autoCallReason,
    callReasonOverride,
  };
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

// Every other call from the same caller (by caller_phone — see
// webhooks/postCall.ts's extractCallerPhone), newest first, including the
// call currently being viewed. Only ever called with a non-null phone (the
// route handler checks first), so a call whose caller_phone was never
// captured (no phone-based metadata, or predates this feature) simply shows
// no history rather than an empty list.
export function buildCallHistory(business: Business, callerPhone: string, limit = 50): CallHistoryRow[] {
  const records = listCallRecordsByPhone(business.id, callerPhone, limit);
  return records.map((record) => {
    const leadLog = findCreateLeadLogByConversationId(business.id, record.conversation_id);
    const jobLog = leadLog ? undefined : findBookJobLogByConversationId(business.id, record.conversation_id);
    const bookingLog = leadLog ?? jobLog;

    let customerName: string | null = null;
    let isEmergency: boolean | null = null;
    if (bookingLog) {
      try {
        const request = JSON.parse(bookingLog.request_json) as { name?: string; isEmergency?: boolean };
        customerName = request.name ?? null;
        isEmergency = request.isEmergency ?? null;
      } catch {
        // leave null on a malformed row rather than crash the list
      }
    }

    const autoStatus = deriveStatus(leadLog, jobLog);
    const statusOverride = (record.status_override as CallStatus | null) ?? null;
    const status = statusOverride ?? autoStatus;

    let isTransferred = false;
    if (record.transcript_json) {
      try {
        const turns = JSON.parse(record.transcript_json) as TranscriptTurn[];
        const info = findTransferInfo(turns);
        isTransferred = info.isTransferred && !info.transferFailed;
      } catch {
        // leave false rather than crash on a malformed transcript
      }
    }

    return {
      conversationId: record.conversation_id,
      receivedAt: record.received_at,
      durationSecs: record.duration_secs,
      customerName,
      phone: record.caller_phone,
      status,
      isEmergency,
      isTransferred,
      summary: record.summary,
    };
  });
}

export interface CallFlags {
  failedTransfer: boolean;
  noBookingCreated: boolean;
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
      // booking, so it shouldn't be flagged for missing one.
      hadRealActivity = turns.some((t) => (t.tool_calls ?? []).some((c) => c.tool_name === "lookup_customer"));
    } catch {
      // malformed/unexpected transcript shape — leave flags false rather than crash
    }
  }

  // Neither a Lead nor a Job exists for this call — checked against both,
  // since a job-booking-mode call that successfully booked a Job legitimately
  // has no Lead at all (that's the whole point of that mode), so checking
  // only the lead log would falsely flag every successful booking.
  const noBookingCreated =
    hadRealActivity &&
    !findCreateLeadLogByConversationId(business.id, record.conversation_id) &&
    !findBookJobLogByConversationId(business.id, record.conversation_id);
  const endedEarly = record.termination_reason === "Call ended by remote party";

  return { failedTransfer, noBookingCreated, endedEarly };
}

export interface CallListFilters {
  failedTransfer: boolean;
  noBookingCreated: boolean;
  endedEarly: boolean;
  from?: string;
  to?: string;
}

// Checking no badge checkboxes means "show everything" — only once at least
// one is checked does this start excluding rows, matching at ANY checked
// flag (not all) since these are meant as "show me problem calls of these
// kinds", not a stricter combined-condition search.
export function matchesBadgeFilters(flags: CallFlags, filters: CallListFilters): boolean {
  const anyBadgeFilterActive = filters.failedTransfer || filters.noBookingCreated || filters.endedEarly;
  if (!anyBadgeFilterActive) return true;
  return (
    (filters.failedTransfer && flags.failedTransfer) ||
    (filters.noBookingCreated && flags.noBookingCreated) ||
    (filters.endedEarly && flags.endedEarly)
  );
}

export type CallStatus = "booked" | "not_booked" | "excused";

// Booked = a Job was actually created; Not Booked = a genuine booking attempt
// happened (a Lead was created, or an attempt failed) but no Job exists;
// Excused = no booking attempt was ever made at all (out of scope, wrong
// number, disqualified caller, etc.) — mirrors the reasoning already used by
// noBookingCreated above, just surfaced as a 3-way status instead of a flag.
//
// `override` is the staff-set Bookability value (elevenlabs_calls.status_override,
// null when unset) — when present it always wins over the auto-derived value,
// letting a human correct a case the AI-driven signal got wrong.
export function deriveStatus(
  leadLog: CreateLeadLogRow | undefined,
  jobLog: CreateLeadLogRow | undefined,
  override?: CallStatus | null,
): CallStatus {
  if (override) return override;
  if (jobLog?.success) return "booked";
  if (leadLog || jobLog) return "not_booked";
  return "excused";
}

export type CallHandler = "ai" | "ai_human";

// "ai_human" only when a transfer_to_number call genuinely succeeded — reuses
// the same transcript-parsing logic as buildCallDetailViewModel's transfer
// detection, so the two never disagree about what counts as a real transfer.
export function deriveCallHandler(record: ElevenLabsCallRecord): CallHandler {
  if (!record.transcript_json) return "ai";
  try {
    const turns = JSON.parse(record.transcript_json) as TranscriptTurn[];
    const { isTransferred, transferFailed } = findTransferInfo(turns);
    return isTransferred && !transferFailed ? "ai_human" : "ai";
  } catch {
    return "ai";
  }
}
