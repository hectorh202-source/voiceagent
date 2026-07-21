import type { DatabaseSync } from "node:sqlite";

// Adds structured_fields to inbound_leads — an encrypted JSON array of the
// label/value pairs the chat widget's assistant records via its update_state
// tool (service type, urgency, preferred timing, etc.). Encrypted like the
// other visitor-supplied columns since a value can carry PII (an address
// detail, a name in passing). A fresh install gets the column from birth via
// schema.ts's bootstrapSchema(); this only backfills a database that predates
// it. Null for every lead that isn't a chat lead, and for chat leads whose
// conversation recorded no fields.
export function migrateInboundLeadStructuredFieldsColumn(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('inbound_leads') WHERE name = 'structured_fields'`)
    .get();
  if (alreadyMigrated) return;

  db.exec(`ALTER TABLE inbound_leads ADD COLUMN structured_fields TEXT`);
}
