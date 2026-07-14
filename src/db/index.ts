import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "../config/env";
import { bootstrapSchema } from "./schema";
import { migrateToMultiTenant } from "./migrateToMultiTenant";
import { migrateCallStatusColumns } from "./migrateCallStatusColumns";
import { migrateUserBusinessAccess } from "./migrateUserBusinessAccess";
import { migrateStatusOverrideColumn } from "./migrateStatusOverrideColumn";
import { migrateCallReasonOverrideColumn } from "./migrateCallReasonOverrideColumn";

const dbDir = path.dirname(env.DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(env.DATABASE_PATH);
db.exec("PRAGMA journal_mode = WAL");
bootstrapSchema(db);
migrateToMultiTenant(db);
migrateCallStatusColumns(db);
migrateUserBusinessAccess(db);
migrateStatusOverrideColumn(db);
migrateCallReasonOverrideColumn(db);
