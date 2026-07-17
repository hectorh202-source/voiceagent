import { db } from "./index";
import { encryptField, encryptNullable, decryptField, decryptNullable } from "../lib/encryption";

export interface InboundLeadRecord {
  id: number;
  business_id: number;
  source: string;
  external_id: string | null;
  received_at: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  raw_payload_json: string;
  status: string;
  is_read: number;
  internal_notes: string | null;
}

// name/phone/email/message/internal_notes carry customer PII, same
// treatment call_log/elevenlabs_calls already give equivalent fields.
// raw_payload_json is NOT NULL and always encrypted (full original payload,
// kept for audit — same reasoning as elevenlabs_calls.raw_payload_json).
function decryptInboundLead(record: InboundLeadRecord): InboundLeadRecord {
  return {
    ...record,
    name: decryptNullable(record.name),
    phone: decryptNullable(record.phone),
    email: decryptNullable(record.email),
    message: decryptNullable(record.message),
    raw_payload_json: decryptField(record.raw_payload_json),
    internal_notes: decryptNullable(record.internal_notes),
  };
}

export interface InboundLeadEntry {
  businessId: number;
  source: string;
  externalId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  rawPayloadJson: string;
}

// external_id is only ever present for a source that redelivers/re-polls the
// same item (Google Local Services Ads' polling ingestion is the first real
// one). DO UPDATE the content columns on conflict, not DO NOTHING — a
// polled source's content can legitimately change after the first sighting
// (an LSA message thread receives new messages under the same lead
// resource; a phone call's billed duration can settle after the call ends),
// so silently ignoring every re-poll would drop real updates forever.
// Mirrors db/callRecords.ts's upsertCallTranscription() exactly: content
// columns update, staff-set triage columns (status/is_read/internal_notes)
// are deliberately excluded from the SET clause so a re-poll can never
// clobber a human's triage work. Must repeat the partial index's WHERE
// clause in the conflict target for SQLite to match it.
const insertWithExternalIdStmt = db.prepare(`
  INSERT INTO inbound_leads (business_id, source, external_id, name, phone, email, message, raw_payload_json)
  VALUES (@businessId, @source, @externalId, @name, @phone, @email, @message, @rawPayloadJson)
  ON CONFLICT(business_id, source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
    name = excluded.name,
    phone = excluded.phone,
    email = excluded.email,
    message = excluded.message,
    raw_payload_json = excluded.raw_payload_json
`);

const insertWithoutExternalIdStmt = db.prepare(`
  INSERT INTO inbound_leads (business_id, source, name, phone, email, message, raw_payload_json)
  VALUES (@businessId, @source, @name, @phone, @email, @message, @rawPayloadJson)
`);

export function insertInboundLead(entry: InboundLeadEntry): void {
  const params = {
    businessId: entry.businessId,
    source: entry.source,
    name: encryptNullable(entry.name ?? null),
    phone: encryptNullable(entry.phone ?? null),
    email: encryptNullable(entry.email ?? null),
    message: encryptNullable(entry.message ?? null),
    rawPayloadJson: encryptField(entry.rawPayloadJson),
  };
  if (entry.externalId) {
    insertWithExternalIdStmt.run({ ...params, externalId: entry.externalId });
  } else {
    insertWithoutExternalIdStmt.run(params);
  }
}

export interface InboundLeadCursor {
  receivedAt: string;
  id: number;
}

export interface InboundLeadFilters {
  from?: string; // "YYYY-MM-DD"
  to?: string; // "YYYY-MM-DD"
  before?: InboundLeadCursor;
  source?: string;
  status?: string;
  isRead?: boolean;
}

// Every filter is a real SQL predicate evaluated before the LIMIT — same
// reasoning as db/callRecords.ts's listCallRecords: filtering rows out in JS
// after a limited page is what breaks correct keyset pagination.
export function listInboundLeads(businessId: number, limit = 50, filters: InboundLeadFilters = {}): InboundLeadRecord[] {
  const conditions = ["business_id = ?"];
  const params: (string | number)[] = [businessId];

  if (filters.from) {
    conditions.push("received_at >= ?");
    params.push(`${filters.from} 00:00:00`);
  }
  if (filters.to) {
    conditions.push("received_at <= ?");
    params.push(`${filters.to} 23:59:59`);
  }
  if (filters.before) {
    conditions.push("(received_at < ? OR (received_at = ? AND id < ?))");
    params.push(filters.before.receivedAt, filters.before.receivedAt, filters.before.id);
  }
  if (filters.source) {
    conditions.push("source = ?");
    params.push(filters.source);
  }
  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.isRead !== undefined) {
    conditions.push("is_read = ?");
    params.push(filters.isRead ? 1 : 0);
  }

  params.push(limit);

  const records = db
    .prepare(
      `SELECT * FROM inbound_leads WHERE ${conditions.join(" AND ")} ORDER BY received_at DESC, id DESC LIMIT ?`,
    )
    .all(...params) as unknown as InboundLeadRecord[];
  return records.map(decryptInboundLead);
}

export function getInboundLeadById(businessId: number, id: number): InboundLeadRecord | undefined {
  const record = db
    .prepare(`SELECT * FROM inbound_leads WHERE id = ? AND business_id = ?`)
    .get(id, businessId) as InboundLeadRecord | undefined;
  return record ? decryptInboundLead(record) : undefined;
}

export interface InboundLeadPatch {
  isRead?: boolean;
  status?: string;
  internalNotes?: string | null;
}

const setIsReadStmt = db.prepare(`UPDATE inbound_leads SET is_read = @isRead WHERE id = @id AND business_id = @businessId`);
const setStatusStmt = db.prepare(`UPDATE inbound_leads SET status = @status WHERE id = @id AND business_id = @businessId`);
const setInternalNotesStmt = db.prepare(
  `UPDATE inbound_leads SET internal_notes = @internalNotes WHERE id = @id AND business_id = @businessId`,
);

export function updateInboundLead(businessId: number, ids: number[], patch: InboundLeadPatch): void {
  for (const id of ids) {
    if (patch.isRead !== undefined) {
      setIsReadStmt.run({ id, businessId, isRead: patch.isRead ? 1 : 0 });
    }
    if (patch.status !== undefined) {
      setStatusStmt.run({ id, businessId, status: patch.status });
    }
    if (patch.internalNotes !== undefined) {
      setInternalNotesStmt.run({ id, businessId, internalNotes: encryptNullable(patch.internalNotes) });
    }
  }
}
