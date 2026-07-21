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
      address_override TEXT,
      -- Whether a Twilio Caller ID (CNAM) lookup has EVER been attempted for
      -- this lead — not PII, so unencrypted. Set once, on first insert, and
      -- never touched again by the poller's upsert (same exclusion-from-
      -- DO-UPDATE-SET treatment as the override columns above). Confirmed
      -- real incident (2026-07-19): without this, a still-nameless
      -- PHONE_CALL lead with genuinely no CNAM data (common — CNAM coverage
      -- for mobile numbers is spotty) got re-queried on every single
      -- 5-minute poll forever, since the only original gate was "does this
      -- lead have a name yet" — an unbounded, ever-repeating cost with no
      -- ceiling. ~30 permanently-unresolved leads x 288 polls/day drained a
      -- real Twilio account (9,717 lookups in under 24 hours). This column
      -- makes the lookup a true one-shot-per-lead, ever, regardless of
      -- whether it succeeded.
      caller_id_checked INTEGER NOT NULL DEFAULT 0,
      -- Encrypted JSON array of {label, value} pairs the chat widget's
      -- assistant recorded via its update_state tool (service type, urgency,
      -- preferred timing, etc.) — structured triage data shown as a list in the
      -- leads inbox, distinct from the free-text message column. Encrypted like
      -- the other visitor-supplied columns since a value can carry PII. Null for
      -- every non-chat lead and for chat leads that recorded nothing.
      structured_fields TEXT
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

    -- The shared knowledge base (see docs/chat-widget.md + knowledge-base.md).
    -- This app is the source of truth for the text; ElevenLabs holds a pushed
    -- copy for the voice agent (elevenlabs_document_id), and the chat widget
    -- retrieves from the chunks below. source_type is text|url|file, and
    -- source_ref keeps the original URL/filename for display — whatever the
    -- source, the content column always holds the extracted plain text.
    --
    -- DELIBERATELY NOT ENCRYPTED, unlike every other content column in this
    -- database. FTS5 cannot index ciphertext (AES-GCM's random IV means the
    -- same text encrypts differently every time), and searchable knowledge is
    -- the entire point of this table. Judged acceptable because this holds
    -- business reference material (services, hours, policies, FAQ), never
    -- customer PII or credentials — the UI says so explicitly.
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT,
      content TEXT NOT NULL,
      elevenlabs_document_id TEXT,
      synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_documents_business ON knowledge_documents(business_id, updated_at);

    -- business_id is denormalized onto the chunk so a search can filter by
    -- business in the same query as the FTS MATCH, without a second join.
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES knowledge_documents(id),
      business_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks(document_id);

    -- External-content FTS5 index over knowledge_chunks.content: the text is
    -- stored once (in knowledge_chunks) and the index references it by rowid,
    -- rather than keeping a second copy. The triggers below are what keep it
    -- in sync — without them an external-content index silently goes stale.
    -- No UPDATE trigger is needed: a document edit always deletes and
    -- reinserts its chunks wholesale (see replaceDocumentChunks).
    --
    -- tokenize='porter unicode61' matters more than it looks. The default
    -- tokenizer does no stemming, so a visitor asking "are you open on sunday"
    -- would NOT match a document saying "closed Sundays" — confirmed by a real
    -- failing test before this was added. Porter stems both to the same root,
    -- which is what makes natural phrasing work against documents written in
    -- whatever tense/plurality the business happened to use.
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts
      USING fts5(content, content='knowledge_chunks', content_rowid='id', tokenize='porter unicode61');

    CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
      INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
      INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
    END;
  `);
}
