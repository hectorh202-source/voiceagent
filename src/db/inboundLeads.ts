import { db } from "./index";
import { encryptField, encryptNullable, decryptField, decryptNullable } from "../lib/encryption";
import { getBusinessById } from "./businesses";
import { isLeadNotifyEnabled, getLeadNotifyEmails, getLeadNotifyCcEmails, getDashboardBaseUrl } from "../settings/store";
import { sendNewLeadNotificationEmail } from "../settings/email";

// Kept in sync by hand with client/src/lib/format.ts's own LEAD_SOURCE_LABEL —
// this one only feeds the notification email's subject/heading, so a source
// missing here just falls back to its raw value rather than breaking anything.
const LEAD_SOURCE_LABEL: Record<string, string> = {
  website_form: "Website Form",
  website_chat: "Website Chat",
  facebook_ads: "Facebook Ads",
  google_ads: "Google Ads (Lead Form)",
  google_lsa: "Google LSA",
  voice_agent: "AI Phone Agent",
};

export interface InboundLeadRecord {
  id: number;
  business_id: number;
  source: string;
  source_detail: string | null;
  external_id: string | null;
  received_at: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  message: string | null;
  // Encrypted JSON array of {label, value} the chat widget recorded via its
  // update_state tool. Null for non-chat leads. Decrypted to a string here;
  // callers (businessRouter's parseLeadRow) JSON.parse it for display.
  structured_fields: string | null;
  raw_payload_json: string;
  status: string;
  is_read: number;
  internal_notes: string | null;
  // Staff-set overrides — see schema.ts's comment on inbound_leads for why
  // these exist (a polling source's re-fetch would otherwise silently
  // clobber a manual edit). Always take precedence over name/phone/email/
  // address at read time (see businessRouter.ts's parseLeadRow), never
  // written by insertInboundLead's poll-driven upsert.
  name_override: string | null;
  email_override: string | null;
  phone_override: string | null;
  address_override: string | null;
  // Not PII — a plain attempt-tracking flag, see schema.ts's comment on the
  // real incident this exists to prevent (an unbounded per-poll Twilio
  // Caller ID retry, 9,717 lookups in under 24 hours). Set once on first
  // insert, never touched again by insertInboundLead's upsert.
  caller_id_checked: number;
}

// name/phone/address/email/message/internal_notes/*_override carry customer
// PII, same treatment call_log/elevenlabs_calls already give equivalent
// fields. raw_payload_json is NOT NULL and always encrypted (full original
// payload, kept for audit — same reasoning as elevenlabs_calls.raw_payload_json).
function decryptInboundLead(record: InboundLeadRecord): InboundLeadRecord {
  return {
    ...record,
    name: decryptNullable(record.name),
    phone: decryptNullable(record.phone),
    address: decryptNullable(record.address),
    email: decryptNullable(record.email),
    message: decryptNullable(record.message),
    structured_fields: decryptNullable(record.structured_fields),
    raw_payload_json: decryptField(record.raw_payload_json),
    internal_notes: decryptNullable(record.internal_notes),
    name_override: decryptNullable(record.name_override),
    email_override: decryptNullable(record.email_override),
    phone_override: decryptNullable(record.phone_override),
    address_override: decryptNullable(record.address_override),
  };
}

export interface InboundLeadEntry {
  businessId: number;
  source: string;
  // A plain, unencrypted sub-classification within a source — e.g. Google
  // LSA's "PHONE_CALL"/"MESSAGE" lead type — distinct from `message`'s
  // actual free-text content. Not PII, so it isn't encrypted like
  // name/phone/email/message below.
  sourceDetail?: string | null;
  externalId?: string | null;
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  email?: string | null;
  message?: string | null;
  // JSON string of the widget's update_state fields (already serialized by the
  // caller). Encrypted at rest here. Omit/null for non-chat leads.
  structuredFields?: string | null;
  rawPayloadJson: string;
  // Whether a Caller ID lookup was attempted for this lead on THIS
  // ingestion pass — only meaningful the first time a row is created (the
  // upsert below deliberately never updates this column afterward, so it's
  // a true one-shot-ever flag, not re-evaluated on later polls).
  callerIdChecked?: boolean;
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
// caller_id_checked needs to be in the DO UPDATE SET clause too, unlike the
// override columns — most polls hit an *existing* row (external_id already
// seen before), not a fresh INSERT, so a column only set in the VALUES
// clause would never actually persist for the realistic case (confirmed by
// testing this directly: after the very first version of this fix, every
// row's caller_id_checked stayed 0 across repeated polls, because all 50
// rows already existed and the UPDATE branch — the one that actually fires
// — never touched the column at all). MAX(...) makes it monotonic: once 1,
// always 1, since a pass where this lead's callerIdChecked comes back false
// (already checked, so leads.ts's gate skipped it and never re-attempted)
// must never reset a real "already checked" back to 0. See schema.ts's
// comment for the real incident this whole column exists to prevent.
const insertWithExternalIdStmt = db.prepare(`
  INSERT INTO inbound_leads (business_id, source, source_detail, external_id, name, phone, address, email, message, structured_fields, raw_payload_json, caller_id_checked)
  VALUES (@businessId, @source, @sourceDetail, @externalId, @name, @phone, @address, @email, @message, @structuredFields, @rawPayloadJson, @callerIdChecked)
  ON CONFLICT(business_id, source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
    source_detail = excluded.source_detail,
    name = excluded.name,
    phone = excluded.phone,
    address = excluded.address,
    email = excluded.email,
    message = excluded.message,
    structured_fields = excluded.structured_fields,
    raw_payload_json = excluded.raw_payload_json,
    caller_id_checked = MAX(inbound_leads.caller_id_checked, excluded.caller_id_checked)
`);

const insertWithoutExternalIdStmt = db.prepare(`
  INSERT INTO inbound_leads (business_id, source, source_detail, name, phone, address, email, message, structured_fields, raw_payload_json, caller_id_checked)
  VALUES (@businessId, @source, @sourceDetail, @name, @phone, @address, @email, @message, @structuredFields, @rawPayloadJson, @callerIdChecked)
`);

// Existence check for the externalId path, run BEFORE the upsert below —
// this is what lets insertInboundLead tell a genuinely new lead apart from a
// polling source (Google LSA) re-fetching one it's already recorded, so the
// notification below only ever fires once per lead, not once per poll.
const existsWithExternalIdStmt = db.prepare(
  `SELECT 1 FROM inbound_leads WHERE business_id = ? AND source = ? AND external_id = ?`,
);

// Fire-and-forget — a mail failure (missing SMTP config, bad recipient, slow
// server) must never affect recording the lead itself, which has already
// happened by the time this is called.
function notifyNewLead(entry: InboundLeadEntry): void {
  if (entry.source === "website_chat") return; // has its own separate, older notify path — see webhooks/leadIntake.ts
  if (!isLeadNotifyEnabled(entry.businessId)) return;
  const recipients = getLeadNotifyEmails(entry.businessId);
  const cc = getLeadNotifyCcEmails(entry.businessId);
  const to = recipients.length > 0 ? recipients : cc;
  const ccFinal = recipients.length > 0 ? cc : [];
  if (to.length === 0) return;

  const business = getBusinessById(entry.businessId);
  if (!business) return;

  const leadsUrl = `${getDashboardBaseUrl(entry.businessId)}/app/${entry.businessId}/leads`;
  sendNewLeadNotificationEmail(
    to,
    {
      businessName: business.name,
      sourceLabel: LEAD_SOURCE_LABEL[entry.source] ?? entry.source,
      name: entry.name ?? undefined,
      phone: entry.phone ?? undefined,
      email: entry.email ?? undefined,
      address: entry.address ?? undefined,
      message: entry.message ?? undefined,
      leadsUrl,
    },
    ccFinal,
  ).catch((error) => {
    console.error("New lead notification email failed:", error instanceof Error ? error.message : error);
  });
}

// Centralizing the notify-on-new-lead call here (rather than once per
// ingestion path) means every current and future Leads-inbox source gets it
// automatically just by calling this function — no call site can forget to
// wire it up, the exact class of bug getLeadSourceLabel's own client-side
// consolidation fixed for source labels.
export function insertInboundLead(entry: InboundLeadEntry): { isNew: boolean } {
  const isNew = entry.externalId
    ? !existsWithExternalIdStmt.get(entry.businessId, entry.source, entry.externalId)
    : true;

  const params = {
    businessId: entry.businessId,
    source: entry.source,
    sourceDetail: entry.sourceDetail ?? null,
    name: encryptNullable(entry.name ?? null),
    phone: encryptNullable(entry.phone ?? null),
    address: encryptNullable(entry.address ?? null),
    email: encryptNullable(entry.email ?? null),
    message: encryptNullable(entry.message ?? null),
    structuredFields: encryptNullable(entry.structuredFields ?? null),
    rawPayloadJson: encryptField(entry.rawPayloadJson),
    callerIdChecked: entry.callerIdChecked ? 1 : 0,
  };
  if (entry.externalId) {
    insertWithExternalIdStmt.run({ ...params, externalId: entry.externalId });
  } else {
    insertWithoutExternalIdStmt.run(params);
  }

  if (isNew) notifyNewLead(entry);
  return { isNew };
}

// The set of external_ids (for a business+source) that have already had a
// Caller ID lookup attempted, ever — computed once per poll and passed into
// fetchRecentLsaLeads so it never re-attempts a lead that's already been
// checked, regardless of whether that check found anything. This is the
// actual fix for the incident described in schema.ts's comment.
export function getCallerIdCheckedExternalIds(businessId: number, source: string): Set<string> {
  const rows = db
    .prepare(
      `SELECT external_id FROM inbound_leads WHERE business_id = ? AND source = ? AND caller_id_checked = 1 AND external_id IS NOT NULL`,
    )
    .all(businessId, source) as { external_id: string }[];
  return new Set(rows.map((r) => r.external_id));
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

// Powers the sidebar's Gmail-style unread badge (AppShell.tsx) — a plain
// COUNT rather than reusing listInboundLeads, since the badge only ever
// needs a number, not full decrypted rows for every unread lead.
export function countUnreadLeads(businessId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM inbound_leads WHERE business_id = ? AND is_read = 0`)
    .get(businessId) as { count: number };
  return row.count;
}

export function getInboundLeadById(businessId: number, id: number): InboundLeadRecord | undefined {
  const record = db
    .prepare(`SELECT * FROM inbound_leads WHERE id = ? AND business_id = ?`)
    .get(id, businessId) as InboundLeadRecord | undefined;
  return record ? decryptInboundLead(record) : undefined;
}

// Platform-admin-only (see businessRouter.ts's DELETE /leads/:id). No child
// table references inbound_leads.id (confirmed against schema.ts) and
// nothing is cached to disk for a lead (Google LSA recordings/attachments
// are proxied live from Google on every request, never stored locally — see
// googleLsa/recordings.ts and googleLsa/attachments.ts), so this is a clean
// single-table delete with no other cleanup needed.
const deleteInboundLeadStmt = db.prepare(`DELETE FROM inbound_leads WHERE id = ? AND business_id = ?`);

export function deleteInboundLead(businessId: number, id: number): void {
  deleteInboundLeadStmt.run(id, businessId);
}

export interface InboundLeadPatch {
  isRead?: boolean;
  status?: string;
  internalNotes?: string | null;
  // Write to name_override/email_override/phone_override/address_override,
  // never the raw name/phone/email/address columns — see schema.ts's
  // comment on why. Passing null is a real, meaningful clear-the-override
  // action (revert to whatever the source itself provides), not "leave
  // unchanged" — omitting the field entirely is how a caller leaves it
  // unchanged.
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

const setIsReadStmt = db.prepare(`UPDATE inbound_leads SET is_read = @isRead WHERE id = @id AND business_id = @businessId`);
const setStatusStmt = db.prepare(`UPDATE inbound_leads SET status = @status WHERE id = @id AND business_id = @businessId`);
const setInternalNotesStmt = db.prepare(
  `UPDATE inbound_leads SET internal_notes = @internalNotes WHERE id = @id AND business_id = @businessId`,
);
const setNameOverrideStmt = db.prepare(
  `UPDATE inbound_leads SET name_override = @nameOverride WHERE id = @id AND business_id = @businessId`,
);
const setEmailOverrideStmt = db.prepare(
  `UPDATE inbound_leads SET email_override = @emailOverride WHERE id = @id AND business_id = @businessId`,
);
const setPhoneOverrideStmt = db.prepare(
  `UPDATE inbound_leads SET phone_override = @phoneOverride WHERE id = @id AND business_id = @businessId`,
);
const setAddressOverrideStmt = db.prepare(
  `UPDATE inbound_leads SET address_override = @addressOverride WHERE id = @id AND business_id = @businessId`,
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
    if (patch.name !== undefined) {
      setNameOverrideStmt.run({ id, businessId, nameOverride: encryptNullable(patch.name) });
    }
    if (patch.email !== undefined) {
      setEmailOverrideStmt.run({ id, businessId, emailOverride: encryptNullable(patch.email) });
    }
    if (patch.phone !== undefined) {
      setPhoneOverrideStmt.run({ id, businessId, phoneOverride: encryptNullable(patch.phone) });
    }
    if (patch.address !== undefined) {
      setAddressOverrideStmt.run({ id, businessId, addressOverride: encryptNullable(patch.address) });
    }
  }
}
