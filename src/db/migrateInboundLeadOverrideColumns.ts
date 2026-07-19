import type { DatabaseSync } from "node:sqlite";

// Adds name_override/email_override/phone_override to inbound_leads — see
// schema.ts's comment on why these exist (staff edits must survive a Google
// LSA lead's next re-poll, same status_override/auto_status split as calls).
// A fresh install never triggers this once schema.ts's bootstrapSchema()
// creates the columns from birth — this only backfills a database that
// predates them.
export function migrateInboundLeadOverrideColumns(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('inbound_leads') WHERE name = 'name_override'`)
    .get();
  if (alreadyMigrated) return;

  db.exec(`ALTER TABLE inbound_leads ADD COLUMN name_override TEXT`);
  db.exec(`ALTER TABLE inbound_leads ADD COLUMN email_override TEXT`);
  db.exec(`ALTER TABLE inbound_leads ADD COLUMN phone_override TEXT`);
}
