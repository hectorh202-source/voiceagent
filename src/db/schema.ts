import type { DatabaseSync } from "node:sqlite";

export function bootstrapSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS call_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      tool_name TEXT NOT NULL,
      phone TEXT,
      request_json TEXT NOT NULL,
      response_json TEXT,
      success INTEGER NOT NULL,
      error_message TEXT
    );
  `);
}
