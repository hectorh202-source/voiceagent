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
      conversation_id TEXT,
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
      call_reason TEXT,
      status_override TEXT,
      call_reason_override TEXT,
      internal_notes TEXT
    );

    -- business_id/received_at exist on every install (present since this
    -- table's original creation), so unlike call_log's conversation_id index
    -- this one is safe to create unconditionally here rather than needing a
    -- migration first. Backs every WHERE business_id = ? ORDER BY received_at
    -- DESC LIMIT ? query — the Calls list, Call Metrics, and Call History
    -- all go through listCallRecords() and hit exactly this shape.
    CREATE INDEX IF NOT EXISTS idx_elevenlabs_calls_business_received ON elevenlabs_calls(business_id, received_at);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      is_platform_admin INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS user_businesses (
      user_id INTEGER NOT NULL REFERENCES users(id),
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      PRIMARY KEY (user_id, business_id)
    );

    -- Only the SHA-256 hash of the reset token is ever stored — the raw
    -- token exists only in the emailed link and the requesting browser's
    -- memory, same principle as password hashing (a DB leak alone can't be
    -- used to reset anyone's password). used_at makes a token strictly
    -- single-use; expires_at is checked alongside it on every lookup.
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
  `);
}
