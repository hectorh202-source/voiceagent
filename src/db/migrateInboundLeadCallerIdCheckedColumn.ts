import type { DatabaseSync } from "node:sqlite";

// Adds caller_id_checked to inbound_leads — see schema.ts's comment for the
// real incident this fixes (an unbounded per-poll Twilio Caller ID retry
// drained a real account, 9,717 lookups in under 24 hours, 2026-07-19).
// Existing rows default to 0 (not yet checked) — the next poll will attempt
// each still-nameless PHONE_CALL lead exactly once more, then never again,
// regardless of outcome. A fresh install never triggers this once
// schema.ts's bootstrapSchema() creates the column from birth — this only
// backfills a database that predates it.
export function migrateInboundLeadCallerIdCheckedColumn(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('inbound_leads') WHERE name = 'caller_id_checked'`)
    .get();
  if (alreadyMigrated) return;

  db.exec(`ALTER TABLE inbound_leads ADD COLUMN caller_id_checked INTEGER NOT NULL DEFAULT 0`);
}
