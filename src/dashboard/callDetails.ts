import { getCallRecord, listCallRecords } from "../db/callRecords";
import type { ElevenLabsCallRecord } from "../db/callRecords";
import { findCreateLeadLogByConversationId, findBookJobLogByConversationId } from "../db/callLog";
import type { CreateLeadLogRow } from "../db/callLog";
import { getRawServiceTitanSettings } from "../settings/store";
import type { Business } from "../db/businesses";
import { computeCallFlagsFromTranscript } from "../lib/callFlags";

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

// Resolves the same phone the Calls list and this call's own detail view
// already show, computed fresh every time rather than stored. Reads
// call_log's own phone column directly — that column is populated straight
// from the tool call's phone argument at write time (see tools/createLead.ts/
// bookJob.ts), so no JSON parsing is needed here at all, unlike the other
// fields (name, isEmergency, leadId/jobId) this file pulls out of
// request_json/response_json elsewhere. A call that never reached a booking
// tool has no phone here, same as it has none anywhere else in the app.
function resolveCallPhone(businessId: number, record: ElevenLabsCallRecord): string | null {
  const leadLog = findCreateLeadLogByConversationId(businessId, record.conversation_id);
  const jobLog = leadLog ? undefined : findBookJobLogByConversationId(businessId, record.conversation_id);
  return (leadLog ?? jobLog)?.phone ?? null;
}

// Every other call from the same caller, newest first, including the call
// currently being viewed — matched by re-deriving each candidate call's
// phone the exact same way the Calls list and this call's own detail view
// already do (via resolveCallPhone above), rather than a separately stored
// column. This is what makes it work immediately for every call already in
// the database, not just ones received after some new tracking landed.
export function buildCallHistory(business: Business, currentRecord: ElevenLabsCallRecord, limit = 1000): CallHistoryRow[] {
  const phone = resolveCallPhone(business.id, currentRecord);
  if (!phone) return [];

  const records = listCallRecords(business.id, limit).filter(
    (record) => resolveCallPhone(business.id, record) === phone,
  );

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
      phone,
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

// Cheap enough (a one-line comparison against the already-decrypted
// termination_reason column) to derive at read time always — unlike
// failedTransfer/noBookingCreated below, it never needed a stored column.
export function isEndedEarly(record: Pick<ElevenLabsCallRecord, "termination_reason">): boolean {
  return record.termination_reason === "Call ended by remote party";
}

// Computed once at write time — webhooks/postCall.ts calls this right after
// a transcript is stored, persisting the result into elevenlabs_calls'
// failed_transfer/no_booking_created/auto_status columns (see
// db/migrateCallFlagsColumns.ts, db/migrateAutoStatusColumn.ts) — rather than
// on every row of every Calls-list page load, which is how this worked
// before. The Calls list (api/businessRouter.ts, db/callRecords.ts's
// listCallRecords) reads those columns directly now, including as real SQL
// WHERE predicates — the thing that actually makes keyset pagination
// correct: filtering rows out *after* a SQL LIMIT means a page can come back
// empty even though more matching rows exist further down the table. The
// transcript-parsing half of this lives in lib/callFlags.ts (kept
// dependency-free so migrateCallFlagsColumns.ts can reuse it without a
// circular import back through db/callLog.ts) — this wrapper adds the
// call_log lookup that decides noBookingCreated/autoStatus, reusing
// deriveStatus below so the two never disagree about what "booked" means.
export function computeCallFlags(
  businessId: number,
  record: Pick<ElevenLabsCallRecord, "conversation_id" | "transcript_json">,
): { failedTransfer: boolean; noBookingCreated: boolean; autoStatus: CallStatus } {
  const { failedTransfer, hadRealActivity } = computeCallFlagsFromTranscript(record.transcript_json);

  // Same "lead takes precedence, job lookup only if no lead" pattern used at
  // read time (api/businessRouter.ts's parseCallRow) — a given call only
  // ever produces one or the other (see db/callLog.ts).
  const leadLog = findCreateLeadLogByConversationId(businessId, record.conversation_id);
  const jobLog = leadLog ? undefined : findBookJobLogByConversationId(businessId, record.conversation_id);

  // Neither a Lead nor a Job exists for this call — checked against both,
  // since a job-booking-mode call that successfully booked a Job legitimately
  // has no Lead at all (that's the whole point of that mode), so checking
  // only the lead log would falsely flag every successful booking.
  const noBookingCreated = hadRealActivity && !leadLog && !jobLog;
  const autoStatus = deriveStatus(leadLog, jobLog);

  return { failedTransfer, noBookingCreated, autoStatus };
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
