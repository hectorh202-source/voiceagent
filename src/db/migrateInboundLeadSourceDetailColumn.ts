import type { DatabaseSync } from "node:sqlite";

// Adds source_detail to inbound_leads — a plain, unencrypted sub-classification
// within a source (e.g. Google LSA's "PHONE_CALL" vs "MESSAGE" lead type),
// distinct from the `message` column's actual free-text content. A fresh
// install never triggers this once schema.ts's bootstrapSchema() creates the
// column from birth — this only backfills a database that predates it.
export function migrateInboundLeadSourceDetailColumn(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('inbound_leads') WHERE name = 'source_detail'`)
    .get();
  if (alreadyMigrated) return;

  db.exec(`ALTER TABLE inbound_leads ADD COLUMN source_detail TEXT`);
}
