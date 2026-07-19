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
      internal_notes TEXT,
      failed_transfer INTEGER NOT NULL DEFAULT 0,
      no_booking_created INTEGER NOT NULL DEFAULT 0,
      auto_status TEXT NOT NULL DEFAULT 'excused',
      twilio_call_sid TEXT
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

    -- Tracks the human-portion recording of a transferred call, keyed by the
    -- Twilio Call SID rather than conversation_id — this row is created (by
    -- the call-status webhook) before ElevenLabs' post-call webhook has
    -- necessarily arrived, so conversation_id may not exist in
    -- elevenlabs_calls yet at that point. elevenlabs_calls.twilio_call_sid
    -- (set once the post-call transcription webhook lands) is what joins the
    -- two at read time, regardless of which webhook happened to arrive
    -- first. The (business_id, call_sid) primary key also doubles as the
    -- idempotency guard against duplicate Status Callback deliveries — see
    -- db/twilioRecordings.ts's claimRecordingRequest.
    CREATE TABLE IF NOT EXISTS twilio_recordings (
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      call_sid TEXT NOT NULL,
      recording_sid TEXT,
      recording_path TEXT,
      status TEXT NOT NULL DEFAULT 'requested',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (business_id, call_sid)
    );

    -- "Lead" already means a ServiceTitan CRM Lead elsewhere in this codebase
    -- (servicetitan/leads.ts, tools/createLead.ts) — this is a deliberately
    -- distinct concept, a raw inbound inquiry from a business's own lead
    -- sources (website forms, website chat, and eventually Facebook/Google
    -- ads leads), tracked here only, never auto-pushed to ServiceTitan.
    -- source/status are unconstrained TEXT (validated at the Zod layer
    -- only, same reasoning as call_reason/status_override elsewhere) so a
    -- new source or status value never needs a migration.
    CREATE TABLE IF NOT EXISTS inbound_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      source TEXT NOT NULL,
      source_detail TEXT,
      external_id TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT,
      phone TEXT,
      address TEXT,
      email TEXT,
      message TEXT,
      raw_payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      is_read INTEGER NOT NULL DEFAULT 0,
      internal_notes TEXT,
      -- Staff-set overrides for a polling source's re-fetched content —
      -- same reasoning as elevenlabs_calls' status_override/auto_status
      -- split. A Google LSA lead gets re-upserted from scratch on every
      -- poll (googleLsa/leads.ts + insertInboundLead's ON CONFLICT DO
      -- UPDATE), so a manual edit written straight into name/phone/email/
      -- address would silently get overwritten (even wiped to NULL) the
      -- next time that lead is re-fetched. These always win over the
      -- auto-derived columns at read time (see businessRouter.ts's
      -- parseLeadRow) and are never touched by the poller, so an edit
      -- survives every future re-poll. Unused by one-shot webhook sources
      -- (website_form/chat), which never get re-touched after insert in
      -- the first place — but kept consistent across all four fields
      -- anyway, since the edit modal is shared by every lead source.
      name_override TEXT,
      email_override TEXT,
      phone_override TEXT,
      address_override TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inbound_leads_business_received ON inbound_leads(business_id, received_at);

    -- Dedup guard for sources that redeliver (Facebook/Google webhooks
    -- retry on failure) — today's website-form/chat submissions have no
    -- external_id and no natural retry, so every one of those is simply its
    -- own row. A partial index costs nothing for the sources that don't use
    -- it and means Facebook/Google ingestion, whenever it's built, never
    -- needs a schema change to get idempotency.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_leads_source_external
      ON inbound_leads(business_id, source, external_id) WHERE external_id IS NOT NULL;

    -- Cross-call memory by phone number (see docs/dynamic-memory.md) — a
    -- business opts in via operational.dynamicMemoryEnabled; when enabled,
    -- the post-call webhook upserts the caller's most recent real call
    -- summary here, and the lookup_customer tool call (already run
    -- silently at the start of every call) reads it back as an extra
    -- response field for that caller's next call.
    --
    -- phone_lookup_hash, not the phone number itself: this table is looked
    -- up BY the caller's phone number (arriving in an inbound webhook)
    -- before any row exists to decrypt, and AES-GCM's random per-encryption
    -- IV means an encrypted phone column could never be searched directly
    -- (two encryptions of the same number produce different ciphertext).
    -- A deterministic SHA-256 hash of the normalized number sidesteps that
    -- — not strong anonymization (US phone numbers are low-entropy enough
    -- to be rainbow-table-able), just an index that avoids storing/
    -- searching the raw number, which v1 has no need to display back
    -- anywhere.
    CREATE TABLE IF NOT EXISTS call_memory (
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      phone_lookup_hash TEXT NOT NULL,
      last_summary TEXT,
      last_call_at TEXT NOT NULL DEFAULT (datetime('now')),
      call_count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (business_id, phone_lookup_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_call_memory_business ON call_memory(business_id);
  `);
}
