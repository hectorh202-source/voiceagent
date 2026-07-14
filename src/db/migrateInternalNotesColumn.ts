import type { DatabaseSync } from "node:sqlite";

// Adds the staff-set internal_notes column to elevenlabs_calls. A fresh
// install never triggers this once schema.ts's bootstrapSchema() creates the
// column from birth — this only backfills a database that predates it.
export function migrateInternalNotesColumn(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('elevenlabs_calls') WHERE name = 'internal_notes'`)
    .get();
  if (alreadyMigrated) return;

  db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN internal_notes TEXT`);
}
