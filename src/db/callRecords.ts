import { db } from "./index";
import { encryptField, encryptNullable, decryptField, decryptNullable } from "../lib/encryption";

export interface ElevenLabsCallRecord {
  conversation_id: string;
  business_id: number;
  agent_id: string | null;
  received_at: string;
  transcript_json: string | null;
  summary: string | null;
  termination_reason: string | null;
  raw_payload_json: string;
  audio_path: string | null;
  is_read: number;
  recovery_status: string | null;
  duration_secs: number | null;
  call_reason: string | null;
  status_override: string | null;
  call_reason_override: string | null;
  internal_notes: string | null;
  failed_transfer: number;
  no_booking_created: number;
  auto_status: string;
  twilio_call_sid: string | null;
}

// transcript_json/summary/raw_payload_json/internal_notes carry customer PII
// (names, addresses, full conversation content) and are encrypted at rest —
// every row read out of elevenlabs_calls must go through this before it
// reaches a caller. raw_payload_json is NOT NULL in the schema, so it's
// always present and always encrypted; the others are nullable.
function decryptCallRecord(record: ElevenLabsCallRecord): ElevenLabsCallRecord {
  return {
    ...record,
    transcript_json: decryptNullable(record.transcript_json),
    summary: decryptNullable(record.summary),
    raw_payload_json: decryptField(record.raw_payload_json),
    internal_notes: decryptNullable(record.internal_notes),
  };
}

interface CallTranscriptionEntry {
  businessId: number;
  conversationId: string;
  agentId?: string | null;
  transcriptJson?: string | null;
  summary?: string | null;
  terminationReason?: string | null;
  rawPayloadJson: string;
  durationSecs?: number | null;
  callReason?: string | null;
  twilioCallSid?: string | null;
}

// duration_secs/call_reason come from the webhook payload, so a redelivered
// webhook should refresh them (included in DO UPDATE SET below). is_read/
// recovery_status are staff-set only (via updateCallStatus) and deliberately
// absent from both the INSERT column list and DO UPDATE SET — that's what
// lets them default once on first insert and survive every later webhook
// delivery untouched, the same trick setAudioPathStmt already relies on for
// not clobbering transcript fields.
const upsertTranscriptionStmt = db.prepare(`
  INSERT INTO elevenlabs_calls (conversation_id, business_id, agent_id, transcript_json, summary, termination_reason, raw_payload_json, duration_secs, call_reason, twilio_call_sid)
  VALUES (@conversationId, @businessId, @agentId, @transcriptJson, @summary, @terminationReason, @rawPayloadJson, @durationSecs, @callReason, @twilioCallSid)
  ON CONFLICT(conversation_id) DO UPDATE SET
    agent_id = excluded.agent_id,
    transcript_json = excluded.transcript_json,
    summary = excluded.summary,
    termination_reason = excluded.termination_reason,
    raw_payload_json = excluded.raw_payload_json,
    duration_secs = excluded.duration_secs,
    call_reason = excluded.call_reason,
    twilio_call_sid = excluded.twilio_call_sid
`);

export function upsertCallTranscription(entry: CallTranscriptionEntry): void {
  upsertTranscriptionStmt.run({
    conversationId: entry.conversationId,
    businessId: entry.businessId,
    agentId: entry.agentId ?? null,
    transcriptJson: encryptNullable(entry.transcriptJson ?? null),
    summary: encryptNullable(entry.summary ?? null),
    terminationReason: entry.terminationReason ?? null,
    rawPayloadJson: encryptField(entry.rawPayloadJson),
    durationSecs: entry.durationSecs ?? null,
    callReason: entry.callReason ?? null,
    twilioCallSid: entry.twilioCallSid ?? null,
  });
}

export interface CallStatusPatch {
  isRead?: boolean;
  recoveryStatus?: "recovered" | "not_recovered" | null;
  statusOverride?: "booked" | "not_booked" | "excused" | null;
  callReasonOverride?: string | null;
  internalNotes?: string | null;
}

const setIsReadStmt = db.prepare(
  `UPDATE elevenlabs_calls SET is_read = @isRead WHERE conversation_id = @conversationId AND business_id = @businessId`,
);
const setRecoveryStatusStmt = db.prepare(
  `UPDATE elevenlabs_calls SET recovery_status = @recoveryStatus WHERE conversation_id = @conversationId AND business_id = @businessId`,
);
const setStatusOverrideStmt = db.prepare(
  `UPDATE elevenlabs_calls SET status_override = @statusOverride WHERE conversation_id = @conversationId AND business_id = @businessId`,
);
const setCallReasonOverrideStmt = db.prepare(
  `UPDATE elevenlabs_calls SET call_reason_override = @callReasonOverride WHERE conversation_id = @conversationId AND business_id = @businessId`,
);
const setInternalNotesStmt = db.prepare(
  `UPDATE elevenlabs_calls SET internal_notes = @internalNotes WHERE conversation_id = @conversationId AND business_id = @businessId`,
);

// Staff-driven status updates (read/unread, recovered/not recovered, the
// manual Bookability and Call Reason overrides, and free-text internal
// notes) — the only writers of these columns; webhook upserts above never
// touch them.
export function updateCallStatus(businessId: number, conversationIds: string[], patch: CallStatusPatch): void {
  for (const conversationId of conversationIds) {
    if (patch.isRead !== undefined) {
      setIsReadStmt.run({ conversationId, businessId, isRead: patch.isRead ? 1 : 0 });
    }
    if (patch.recoveryStatus !== undefined) {
      setRecoveryStatusStmt.run({ conversationId, businessId, recoveryStatus: patch.recoveryStatus });
    }
    if (patch.statusOverride !== undefined) {
      setStatusOverrideStmt.run({ conversationId, businessId, statusOverride: patch.statusOverride });
    }
    if (patch.callReasonOverride !== undefined) {
      setCallReasonOverrideStmt.run({ conversationId, businessId, callReasonOverride: patch.callReasonOverride });
    }
    if (patch.internalNotes !== undefined) {
      setInternalNotesStmt.run({ conversationId, businessId, internalNotes: encryptNullable(patch.internalNotes) });
    }
  }
}

// The audio webhook can arrive before or after the transcription webhook, so
// this upserts a placeholder row if one doesn't exist yet without clobbering
// whichever half already landed.
const setAudioPathStmt = db.prepare(`
  INSERT INTO elevenlabs_calls (conversation_id, business_id, raw_payload_json, audio_path)
  VALUES (@conversationId, @businessId, @emptyPayload, @audioPath)
  ON CONFLICT(conversation_id) DO UPDATE SET audio_path = excluded.audio_path
`);

export function setCallAudioPath(businessId: number, conversationId: string, audioPath: string): void {
  // raw_payload_json is NOT NULL and always encrypted (see decryptCallRecord
  // above) — this placeholder must be too, or a later read of a row that was
  // only ever touched by this INSERT (audio webhook arriving before the
  // transcription webhook) would fail to decrypt.
  setAudioPathStmt.run({ conversationId, businessId, audioPath, emptyPayload: encryptField("{}") });
}

const setCallDerivedFieldsStmt = db.prepare(
  `UPDATE elevenlabs_calls SET failed_transfer = @failedTransfer, no_booking_created = @noBookingCreated, auto_status = @autoStatus
   WHERE conversation_id = @conversationId AND business_id = @businessId`,
);

// Called once from webhooks/postCall.ts, right after a transcript is stored
// (and redelivered on a webhook retry, same as duration_secs/call_reason) —
// see dashboard/callDetails.ts's computeCallFlags for what's actually being
// computed and why this moved from read time to write time.
export function setCallDerivedFields(
  businessId: number,
  conversationId: string,
  failedTransfer: boolean,
  noBookingCreated: boolean,
  autoStatus: string,
): void {
  setCallDerivedFieldsStmt.run({
    conversationId,
    businessId,
    failedTransfer: failedTransfer ? 1 : 0,
    noBookingCreated: noBookingCreated ? 1 : 0,
    autoStatus,
  });
}

// Scoped by business_id as well as conversation_id — this is the one lookup
// the public, unauthenticated /b/:businessId/calls/:conversationId page
// depends on for tenant isolation, since the URL itself is the only access
// control. A conversationId belonging to another business must never match
// here just because the ID happens to be correct.
// Powers the sidebar's Gmail-style unread badge (AppShell.tsx) — a plain
// COUNT rather than reusing listCallRecords, since the badge only ever needs
// a number, not full decrypted rows for every unread call.
export function countUnreadCalls(businessId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM elevenlabs_calls WHERE business_id = ? AND is_read = 0`)
    .get(businessId) as { count: number };
  return row.count;
}

export function getCallRecord(businessId: number, conversationId: string): ElevenLabsCallRecord | undefined {
  const record = db
    .prepare(`SELECT * FROM elevenlabs_calls WHERE conversation_id = ? AND business_id = ?`)
    .get(conversationId, businessId) as ElevenLabsCallRecord | undefined;
  return record ? decryptCallRecord(record) : undefined;
}

export interface CallCursor {
  receivedAt: string;
  conversationId: string;
}

export interface CallDateRange {
  from?: string; // "YYYY-MM-DD"
  to?: string; // "YYYY-MM-DD"
  // Keyset (cursor) pagination — only rows strictly before this (receivedAt,
  // conversationId) pair, in the same DESC order this query returns rows in.
  // Pass the last row of the previous page back here to fetch the next one.
  // The conversationId tie-break matters because received_at is only
  // second-granularity (datetime('now')) — two calls landing in the same
  // second would otherwise risk a skipped or duplicated row right at a page
  // boundary; comparing the composite pair keeps that boundary exact even
  // then.
  before?: CallCursor;
  // failedTransfer/noBookingCreated/endedEarly are OR'd together, same
  // semantics the old read-time matchesBadgeFilters() had: none checked
  // means "show everything," any checked means "match ANY checked one."
  failedTransfer?: boolean;
  noBookingCreated?: boolean;
  endedEarly?: boolean;
  isRead?: boolean;
  recoveryStatus?: "recovered" | "not_recovered" | null;
  // Resolved status (a manual override always wins over the auto-derived
  // one) — see dashboard/callDetails.ts's computeCallFlags/deriveStatus for
  // where auto_status/status_override actually come from.
  status?: "booked" | "not_booked" | "excused";
}

// received_at is stored as UTC with no timezone marker (see dashboard/views.ts's
// formatCallTime), so "from"/"to" boundaries here are UTC calendar days, not
// the business's configured local day — a call right at a day boundary could
// land in the adjacent day's filter results. Acceptable for a coarse filter;
// revisit only if that mismatch becomes a real complaint.
//
// Every filter below is a plain SQL predicate evaluated before the LIMIT —
// deliberately, since filtering rows out in JS *after* fetching a limited
// page is exactly what breaks correct keyset pagination (a page could come
// back looking empty even though matching rows exist further down the
// table). That's only possible now because failed_transfer/no_booking_created/
// auto_status are precomputed columns rather than needing a transcript parse
// or a call_log query per row at read time — see db/migrateCallFlagsColumns.ts
// and db/migrateAutoStatusColumn.ts.
export function listCallRecords(businessId: number, limit = 50, range: CallDateRange = {}): ElevenLabsCallRecord[] {
  const conditions = ["business_id = ?"];
  const params: (string | number)[] = [businessId];

  if (range.from) {
    conditions.push("received_at >= ?");
    params.push(`${range.from} 00:00:00`);
  }
  if (range.to) {
    conditions.push("received_at <= ?");
    params.push(`${range.to} 23:59:59`);
  }
  if (range.before) {
    conditions.push("(received_at < ? OR (received_at = ? AND conversation_id < ?))");
    params.push(range.before.receivedAt, range.before.receivedAt, range.before.conversationId);
  }

  const badgeConditions: string[] = [];
  if (range.failedTransfer) badgeConditions.push("failed_transfer = 1");
  if (range.noBookingCreated) badgeConditions.push("no_booking_created = 1");
  if (range.endedEarly) badgeConditions.push("termination_reason = 'Call ended by remote party'");
  if (badgeConditions.length > 0) conditions.push(`(${badgeConditions.join(" OR ")})`);

  if (range.isRead !== undefined) {
    conditions.push("is_read = ?");
    params.push(range.isRead ? 1 : 0);
  }
  if (range.recoveryStatus !== undefined) {
    if (range.recoveryStatus === null) {
      conditions.push("recovery_status IS NULL");
    } else {
      conditions.push("recovery_status = ?");
      params.push(range.recoveryStatus);
    }
  }
  if (range.status) {
    conditions.push("COALESCE(status_override, auto_status) = ?");
    params.push(range.status);
  }

  params.push(limit);

  const records = db
    .prepare(
      `SELECT * FROM elevenlabs_calls WHERE ${conditions.join(" AND ")} ORDER BY received_at DESC, conversation_id DESC LIMIT ?`,
    )
    .all(...params) as unknown as ElevenLabsCallRecord[];
  return records.map(decryptCallRecord);
}
