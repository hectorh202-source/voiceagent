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
      business_id INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      tool_name TEXT NOT NULL,
      phone TEXT,
      request_json TEXT NOT NULL,
      response_json TEXT,
      success INTEGER NOT NULL,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      session_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS elevenlabs_calls (
      conversation_id TEXT PRIMARY KEY,
      business_id INTEGER NOT NULL DEFAULT 1,
      agent_id TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      transcript_json TEXT,
      summary TEXT,
      termination_reason TEXT,
      raw_payload_json TEXT NOT NULL,
      audio_path TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      recovery_status TEXT,
      duration_secs INTEGER,
      call_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS business_settings (
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (business_id, key)
    );
  `);
}
