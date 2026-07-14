import type { DatabaseSync } from "node:sqlite";

// Adds per-business access scoping: is_platform_admin on users, plus a
// user_businesses join table. A fresh install never triggers this once
// schema.ts's bootstrapSchema() creates both from birth — this only
// backfills a pre-existing database. Every existing user is marked a
// platform admin (full access to every business, exactly what they already
// had before this feature existed) so nobody is unexpectedly locked out on
// deploy — only newly-created users default to scoped/non-admin.
export function migrateUserBusinessAccess(db: DatabaseSync): void {
  const alreadyMigrated = db
    .prepare(`SELECT 1 FROM pragma_table_info('users') WHERE name = 'is_platform_admin'`)
    .get();
  if (alreadyMigrated) return;

  db.exec("BEGIN");
  try {
    db.exec(`ALTER TABLE users ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_businesses (
        user_id INTEGER NOT NULL REFERENCES users(id),
        business_id INTEGER NOT NULL REFERENCES businesses(id),
        PRIMARY KEY (user_id, business_id)
      );
    `);
    db.exec(`UPDATE users SET is_platform_admin = 1`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
