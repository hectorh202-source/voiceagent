import { db } from "./index";
import { encryptField, encryptNullable, decryptField, decryptNullable } from "../lib/encryption";

interface CallLogEntry {
  businessId: number;
  toolName: string;
  phone?: string | null;
  request: unknown;
  response?: unknown;
  success: boolean;
  errorMessage?: string | null;
}

// create_lead/book_job's request bodies already carry conversationId (see
// tools/createLead.ts, tools/bookJob.ts) — pulling it out at write time into
// its own indexed column is what lets findCreateLeadLogByConversationId/
// findBookJobLogByConversationId below do an exact indexed lookup instead of
// scanning every row's request_json. A tool call without one (check_availability,
// lookup_customer) just stores null, same as always.
function extractConversationId(request: unknown): string | null {
  if (request && typeof request === "object" && "conversationId" in request) {
    const value = (request as { conversationId?: unknown }).conversationId;
    return typeof value === "string" ? value : null;
  }
  return null;
}

const insertStmt = db.prepare(`
  INSERT INTO call_log (business_id, tool_name, phone, conversation_id, request_json, response_json, success, error_message)
  VALUES (@businessId, @toolName, @phone, @conversationId, @requestJson, @responseJson, @success, @errorMessage)
`);

export function logToolCall(entry: CallLogEntry): void {
  insertStmt.run({
    businessId: entry.businessId,
    toolName: entry.toolName,
    phone: encryptNullable(entry.phone ?? null),
    conversationId: extractConversationId(entry.request),
    requestJson: encryptField(JSON.stringify(entry.request)),
    responseJson: entry.response !== undefined ? encryptField(JSON.stringify(entry.response)) : null,
    success: entry.success ? 1 : 0,
    errorMessage: entry.errorMessage ?? null,
  });
}

// Platform-admin-only Call delete (see businessRouter.ts's DELETE
// /calls/:conversationId) cleans up these rows too, so a deleted call
// doesn't leave orphaned create_lead/book_job tool-call logs still
// pointing at a conversationId that no longer exists anywhere else.
const deleteByConversationStmt = db.prepare(`DELETE FROM call_log WHERE business_id = ? AND conversation_id = ?`);

export function deleteCallLogsForConversation(businessId: number, conversationId: string): void {
  deleteByConversationStmt.run(businessId, conversationId);
}

export function getRecentCallLogs(businessId: number, limit = 50) {
  const rows = db
    .prepare(`SELECT * FROM call_log WHERE business_id = ? ORDER BY id DESC LIMIT ?`)
    .all(businessId, limit) as { phone: string | null; request_json: string; response_json: string | null }[];
  return rows.map((row) => ({
    ...row,
    phone: decryptNullable(row.phone),
    request_json: decryptField(row.request_json),
    response_json: decryptNullable(row.response_json),
  }));
}

export interface CreateLeadLogRow {
  request_json: string;
  response_json: string | null;
  created_at: string;
  success: number;
  phone: string | null;
}

function decryptLeadLogRow(row: CreateLeadLogRow): CreateLeadLogRow {
  return {
    ...row,
    request_json: decryptField(row.request_json),
    response_json: decryptNullable(row.response_json),
    phone: decryptNullable(row.phone),
  };
}

// Correlates a call_log create_lead row with an elevenlabs_calls record —
// an indexed exact match on conversation_id (idx_call_log_business_conversation),
// not a request_json substring scan; see migrateCallLogConversationIdColumn.ts
// for why that scan was replaced. Always scoped by business_id too, not just
// conversationId — otherwise a conversationId lookup could cross into
// another business's row.
export function findCreateLeadLogByConversationId(
  businessId: number,
  conversationId: string,
): CreateLeadLogRow | undefined {
  const row = db
    .prepare(
      `SELECT request_json, response_json, created_at, success, phone FROM call_log
       WHERE business_id = ? AND tool_name = 'create_lead' AND conversation_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(businessId, conversationId) as CreateLeadLogRow | undefined;
  return row ? decryptLeadLogRow(row) : undefined;
}

// Parallel to findCreateLeadLogByConversationId, for job-booking-mode
// businesses — a given call only ever produces a Lead or a Job, never both,
// via book_job's own emergency safety net (see tools/bookJob.ts), so callers
// check this and the lead finder as mutually exclusive alternatives.
export function findBookJobLogByConversationId(
  businessId: number,
  conversationId: string,
): CreateLeadLogRow | undefined {
  const row = db
    .prepare(
      `SELECT request_json, response_json, created_at, success, phone FROM call_log
       WHERE business_id = ? AND tool_name = 'book_job' AND conversation_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(businessId, conversationId) as CreateLeadLogRow | undefined;
  return row ? decryptLeadLogRow(row) : undefined;
}
