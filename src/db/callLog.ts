import { db } from "./index";

interface CallLogEntry {
  businessId: number;
  toolName: string;
  phone?: string | null;
  request: unknown;
  response?: unknown;
  success: boolean;
  errorMessage?: string | null;
}

const insertStmt = db.prepare(`
  INSERT INTO call_log (business_id, tool_name, phone, request_json, response_json, success, error_message)
  VALUES (@businessId, @toolName, @phone, @requestJson, @responseJson, @success, @errorMessage)
`);

export function logToolCall(entry: CallLogEntry): void {
  insertStmt.run({
    businessId: entry.businessId,
    toolName: entry.toolName,
    phone: entry.phone ?? null,
    requestJson: JSON.stringify(entry.request),
    responseJson: entry.response !== undefined ? JSON.stringify(entry.response) : null,
    success: entry.success ? 1 : 0,
    errorMessage: entry.errorMessage ?? null,
  });
}

export function getRecentCallLogs(businessId: number, limit = 50) {
  return db
    .prepare(`SELECT * FROM call_log WHERE business_id = ? ORDER BY id DESC LIMIT ?`)
    .all(businessId, limit);
}

export interface CreateLeadLogRow {
  request_json: string;
  response_json: string | null;
  created_at: string;
}

// Correlates a call_log create_lead row with an elevenlabs_calls record —
// the conversationId rides along inside the already-JSON-serialized request,
// so this is a simple substring match rather than a dedicated indexed column.
// Always scoped by business_id too, not just conversationId — otherwise a
// conversationId lookup could cross into another business's row.
export function findCreateLeadLogByConversationId(
  businessId: number,
  conversationId: string,
): CreateLeadLogRow | undefined {
  return db
    .prepare(
      `SELECT request_json, response_json, created_at FROM call_log
       WHERE business_id = ? AND tool_name = 'create_lead' AND request_json LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(businessId, `%${conversationId}%`) as CreateLeadLogRow | undefined;
}

// Parallel to findCreateLeadLogByConversationId, for job-booking-mode
// businesses — a given call only ever produces a Lead or a Job, never both,
// via book_job's own emergency safety net (see tools/bookJob.ts), so callers
// check this and the lead finder as mutually exclusive alternatives.
export function findBookJobLogByConversationId(
  businessId: number,
  conversationId: string,
): CreateLeadLogRow | undefined {
  return db
    .prepare(
      `SELECT request_json, response_json, created_at FROM call_log
       WHERE business_id = ? AND tool_name = 'book_job' AND request_json LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(businessId, `%${conversationId}%`) as CreateLeadLogRow | undefined;
}
