import type { DatabaseSync } from "node:sqlite";

// Adds the twilio_call_sid column to elevenlabs_calls. A fresh install never
// triggers this once schema.ts's bootstrapSchema() creates the column from
// birth — this only backfills a database that predates it.
export function migrateTwilioCallSidColumn(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('elevenlabs_calls') WHERE name = 'twilio_call_sid'`)
    .get();
  if (alreadyMigrated) return;

  db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN twilio_call_sid TEXT`);
}
