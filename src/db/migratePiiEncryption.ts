import type { DatabaseSync } from "node:sqlite";
import { encryptField, encryptNullable } from "../lib/encryption";

// One-time backfill: call_log.phone/request_json/response_json and
// elevenlabs_calls.transcript_json/summary/raw_payload_json/internal_notes
// held customer PII (names, addresses, phone numbers, full transcripts) as
// plain SQLite text. From this migration onward, db/callLog.ts and
// db/callRecords.ts encrypt/decrypt these columns on every write/read (same
// AES-256-GCM scheme settings/store.ts already uses for credentials) — this
// just encrypts whatever plaintext already exists so old and new rows are in
// the same (encrypted) format.
//
// Marker lives in the `settings` table directly via raw SQL rather than
// through settings/store.ts's getSetting/setSetting — importing store.ts
// here would create a circular import (db/index.ts -> this file ->
// settings/store.ts -> db/index.ts). The marker value itself is still run
// through encryptField for format consistency with every other row in that
// table, even though its own content isn't sensitive.
const MARKER_KEY = "internal.piiEncryptionMigrated";

interface CallLogRow {
  id: number;
  phone: string | null;
  request_json: string;
  response_json: string | null;
}

interface ElevenLabsCallRow {
  conversation_id: string;
  transcript_json: string | null;
  summary: string | null;
  raw_payload_json: string;
  internal_notes: string | null;
}

export function migratePiiEncryption(db: DatabaseSync): void {
  const marker = db.prepare(`SELECT 1 FROM settings WHERE key = ?`).get(MARKER_KEY);
  if (marker) return;

  db.exec("BEGIN");
  try {
    const callLogRows = db
      .prepare(`SELECT id, phone, request_json, response_json FROM call_log`)
      .all() as unknown as CallLogRow[];
    const updateCallLog = db.prepare(`UPDATE call_log SET phone = ?, request_json = ?, response_json = ? WHERE id = ?`);
    for (const row of callLogRows) {
      updateCallLog.run(encryptNullable(row.phone), encryptField(row.request_json), encryptNullable(row.response_json), row.id);
    }

    const callRows = db
      .prepare(`SELECT conversation_id, transcript_json, summary, raw_payload_json, internal_notes FROM elevenlabs_calls`)
      .all() as unknown as ElevenLabsCallRow[];
    const updateCalls = db.prepare(
      `UPDATE elevenlabs_calls SET transcript_json = ?, summary = ?, raw_payload_json = ?, internal_notes = ? WHERE conversation_id = ?`,
    );
    for (const row of callRows) {
      updateCalls.run(
        encryptNullable(row.transcript_json),
        encryptNullable(row.summary),
        encryptField(row.raw_payload_json),
        encryptNullable(row.internal_notes),
        row.conversation_id,
      );
    }

    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run(
      MARKER_KEY,
      encryptField("true"),
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
