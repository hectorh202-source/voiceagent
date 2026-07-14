import type { DatabaseSync } from "node:sqlite";

// Adds an indexed conversation_id column to call_log, replacing the
// unindexed `request_json LIKE '%...%'` scan that
// findCreateLeadLogByConversationId/findBookJobLogByConversationId used to
// rely on — that scan reads every row in call_log on every lookup, which
// scales with total history rather than the size of any one call. Call
// History (docs/call-dashboard.md) does dozens to hundreds of these lookups
// per single call-detail page view, which made the old scan's cost sharply
// worse. A fresh install never triggers this once schema.ts creates the
// column (and its index) from birth — this only backfills a database that
// predates it.
export function migrateCallLogConversationIdColumn(db: DatabaseSync): void {
  const columnExists = db
    .prepare(`SELECT 1 FROM pragma_table_info('call_log') WHERE name = 'conversation_id'`)
    .get();

  // On a fresh install schema.ts's CREATE TABLE already includes this column
  // — nothing to add or backfill, but the index below still needs creating
  // (it deliberately isn't part of the CREATE TABLE statement itself: that
  // runs unconditionally on every startup via CREATE TABLE IF NOT EXISTS, so
  // an index referencing this column in that same statement would fail the
  // moment it ran against an existing pre-migration database whose table
  // doesn't have the column yet — confirmed by hitting exactly that error
  // when this was first written this way).
  if (!columnExists) {
    db.exec("BEGIN");
    try {
      db.exec(`ALTER TABLE call_log ADD COLUMN conversation_id TEXT`);
      // conversationId already rides along inside every create_lead/book_job
      // request body (see tools/createLead.ts, tools/bookJob.ts) —
      // json_extract pulls it out for every existing row in one pass rather
      // than a row-by-row JS loop.
      db.exec(`UPDATE call_log SET conversation_id = json_extract(request_json, '$.conversationId')`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_call_log_business_conversation ON call_log(business_id, conversation_id)`);
}
