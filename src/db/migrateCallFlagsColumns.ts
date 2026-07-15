import type { DatabaseSync } from "node:sqlite";
import { computeCallFlagsFromTranscript } from "../lib/callFlags";
import { decryptNullable } from "../lib/encryption";

// Adds failed_transfer/no_booking_created to elevenlabs_calls (see
// dashboard/callDetails.ts's computeCallFlags — moved from a read-time
// computation on every Calls-list page load to a write-time one, computed
// once in webhooks/postCall.ts as each transcript arrives) and backfills the
// handful of rows already stored before this migration existed.
//
// Deliberately does its own raw call_log lookup below (via the `db`
// parameter) rather than importing db/callLog.ts's
// findCreateLeadLogByConversationId/findBookJobLogByConversationId — this
// migration runs during db/index.ts's own module initialization, and
// db/callLog.ts imports the `db` singleton from that same still-initializing
// module, which crashes with "Cannot access 'db' before initialization."
// Same reasoning as computeCallFlagsFromTranscript living in lib/callFlags.ts
// instead of being imported from dashboard/callDetails.ts here.
export function migrateCallFlagsColumns(db: DatabaseSync): void {
  const columnExists = db
    .prepare(`SELECT 1 FROM pragma_table_info('elevenlabs_calls') WHERE name = 'failed_transfer'`)
    .get();
  if (columnExists) return;

  db.exec("BEGIN");
  try {
    db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN failed_transfer INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN no_booking_created INTEGER NOT NULL DEFAULT 0`);

    const rows = db
      .prepare(`SELECT conversation_id, business_id, transcript_json FROM elevenlabs_calls`)
      .all() as { conversation_id: string; business_id: number; transcript_json: string | null }[];
    const hasBookingLogStmt = db.prepare(
      `SELECT 1 FROM call_log WHERE business_id = ? AND conversation_id = ? AND tool_name IN ('create_lead', 'book_job') LIMIT 1`,
    );
    const updateFlags = db.prepare(
      `UPDATE elevenlabs_calls SET failed_transfer = ?, no_booking_created = ? WHERE conversation_id = ?`,
    );
    for (const row of rows) {
      const { failedTransfer, hadRealActivity } = computeCallFlagsFromTranscript(decryptNullable(row.transcript_json));
      const hasBookingLog = !!hasBookingLogStmt.get(row.business_id, row.conversation_id);
      const noBookingCreated = hadRealActivity && !hasBookingLog;
      updateFlags.run(failedTransfer ? 1 : 0, noBookingCreated ? 1 : 0, row.conversation_id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
