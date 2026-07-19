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
import { migrateInternalNotesColumn } from "./migrateInternalNotesColumn";
import { migrateCallLogConversationIdColumn } from "./migrateCallLogConversationIdColumn";
import { migratePiiEncryption } from "./migratePiiEncryption";
import { migrateCallFlagsColumns } from "./migrateCallFlagsColumns";
import { migrateAutoStatusColumn } from "./migrateAutoStatusColumn";
import { migrateTwilioCallSidColumn } from "./migrateTwilioCallSidColumn";
import { migrateInboundLeadSourceDetailColumn } from "./migrateInboundLeadSourceDetailColumn";
import { migrateInboundLeadOverrideColumns } from "./migrateInboundLeadOverrideColumns";
import { migrateInboundLeadAddressColumn } from "./migrateInboundLeadAddressColumn";
import { migrateInboundLeadCallerIdCheckedColumn } from "./migrateInboundLeadCallerIdCheckedColumn";

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
migrateInternalNotesColumn(db);
migrateCallLogConversationIdColumn(db);
migratePiiEncryption(db);
migrateCallFlagsColumns(db);
migrateAutoStatusColumn(db);
migrateTwilioCallSidColumn(db);
migrateInboundLeadSourceDetailColumn(db);
migrateInboundLeadOverrideColumns(db);
migrateInboundLeadAddressColumn(db);
migrateInboundLeadCallerIdCheckedColumn(db);
