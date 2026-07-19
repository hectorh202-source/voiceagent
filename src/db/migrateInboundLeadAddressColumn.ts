import type { DatabaseSync } from "node:sqlite";

// Adds address/address_override to inbound_leads — a website contact form's
// address field had no dedicated column before this (it fell into the
// generic message/leftover dump instead), and address_override follows the
// same staff-edit-survives-a-repoll reasoning as name_override/email_override/
// phone_override (see schema.ts's comment on inbound_leads). A fresh install
// never triggers this once schema.ts's bootstrapSchema() creates the columns
// from birth — this only backfills a database that predates them.
export function migrateInboundLeadAddressColumn(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('inbound_leads') WHERE name = 'address'`)
    .get();
  if (alreadyMigrated) return;

  db.exec(`ALTER TABLE inbound_leads ADD COLUMN address TEXT`);
  db.exec(`ALTER TABLE inbound_leads ADD COLUMN address_override TEXT`);
}
