import type { DatabaseSync } from "node:sqlite";

const TITANZ_BUSINESS_NAME = "TitanZ Plumbing and Air Conditioning";

// One-time historical fixup for a database created before this app supported
// multiple businesses. A brand-new install never triggers this — schema.ts's
// bootstrapSchema() already creates call_log/elevenlabs_calls WITH
// business_id from birth, so this check is already satisfied and the
// function returns immediately. Only a pre-existing single-tenant database
// (missing that column, since "CREATE TABLE IF NOT EXISTS" left its old
// shape untouched) falls through to actually migrate.
export function migrateToMultiTenant(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('call_log') WHERE name = 'business_id'`)
    .get();
  if (alreadyMigrated) return;

  db.exec("BEGIN");
  try {
    db.exec(`ALTER TABLE call_log ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1`);
    db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1`);

    // Only the previously-configured business's credentials live in `settings`
    // under these prefixes — if there are none, this was never actually
    // configured (e.g. a fresh install that happened to predate the
    // business_id column), so there's nothing to attach a "Business #1" to.
    const legacyRows = db
      .prepare(
        `SELECT key, value FROM settings
         WHERE key LIKE 'elevenlabs.%' OR key LIKE 'servicetitan.%' OR key LIKE 'operational.%'`,
      )
      .all() as { key: string; value: string }[];

    if (legacyRows.length > 0) {
      db.prepare(`INSERT INTO businesses (id, name) VALUES (1, ?)`).run(TITANZ_BUSINESS_NAME);
      const insertBusinessSetting = db.prepare(
        `INSERT INTO business_settings (business_id, key, value) VALUES (1, ?, ?)`,
      );
      for (const row of legacyRows) {
        insertBusinessSetting.run(row.key, row.value);
      }
      db.exec(
        `DELETE FROM settings WHERE key LIKE 'elevenlabs.%' OR key LIKE 'servicetitan.%' OR key LIKE 'operational.%'`,
      );
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
