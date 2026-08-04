import type { DatabaseSync } from "node:sqlite";

// Adds the service_titan_call_reason column to elevenlabs_calls. A fresh
// install never triggers this once schema.ts's bootstrapSchema() creates the
// column from birth — this only backfills a database that predates it.
export function migrateServiceTitanCallReasonColumn(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('elevenlabs_calls') WHERE name = 'service_titan_call_reason'`)
    .get();
  if (alreadyMigrated) return;

  db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN service_titan_call_reason TEXT`);
}
