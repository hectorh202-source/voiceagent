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
