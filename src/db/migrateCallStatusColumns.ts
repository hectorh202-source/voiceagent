import type { DatabaseSync } from "node:sqlite";

// Adds staff-set (is_read/recovery_status) and derived-metric (duration_secs/
// call_reason) columns to elevenlabs_calls. A fresh install never triggers
// this once schema.ts's bootstrapSchema() creates these columns from birth —
// this only backfills a database that predates them.
export function migrateCallStatusColumns(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('elevenlabs_calls') WHERE name = 'is_read'`)
    .get();
  if (alreadyMigrated) return;

  db.exec("BEGIN");
  try {
    db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN recovery_status TEXT`);
    db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN duration_secs INTEGER`);
    db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN call_reason TEXT`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
