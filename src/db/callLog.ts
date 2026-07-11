import { db } from "./index";

interface CallLogEntry {
  toolName: string;
  phone?: string | null;
  request: unknown;
  response?: unknown;
  success: boolean;
  errorMessage?: string | null;
}

const insertStmt = db.prepare(`
  INSERT INTO call_log (tool_name, phone, request_json, response_json, success, error_message)
  VALUES (@toolName, @phone, @requestJson, @responseJson, @success, @errorMessage)
`);

export function logToolCall(entry: CallLogEntry): void {
  insertStmt.run({
    toolName: entry.toolName,
    phone: entry.phone ?? null,
    requestJson: JSON.stringify(entry.request),
    responseJson: entry.response !== undefined ? JSON.stringify(entry.response) : null,
    success: entry.success ? 1 : 0,
    errorMessage: entry.errorMessage ?? null,
  });
}

export function getRecentCallLogs(limit = 50) {
  return db
    .prepare(`SELECT * FROM call_log ORDER BY id DESC LIMIT ?`)
    .all(limit);
}

export interface CreateLeadLogRow {
  request_json: string;
  response_json: string | null;
  created_at: string;
}

// Correlates a call_log create_lead row with an elevenlabs_calls record —
// the conversationId rides along inside the already-JSON-serialized request,
// so this is a simple substring match rather than a dedicated indexed column.
export function findCreateLeadLogByConversationId(conversationId: string): CreateLeadLogRow | undefined {
  return db
    .prepare(
      `SELECT request_json, response_json, created_at FROM call_log
       WHERE tool_name = 'create_lead' AND request_json LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(`%${conversationId}%`) as CreateLeadLogRow | undefined;
}
