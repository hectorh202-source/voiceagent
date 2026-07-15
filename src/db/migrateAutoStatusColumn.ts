import type { DatabaseSync } from "node:sqlite";

// Adds auto_status to elevenlabs_calls — the resolved-status filter
// (?status=booked/not_booked/excused on GET /calls) used to require parsing
// call_log per row at read time (deriveStatus(), dashboard/callDetails.ts),
// which is exactly the kind of per-row read-time cost that breaks correct
// keyset pagination: filtering out rows *after* a SQL LIMIT means a page can
// come back empty even though more matching rows exist further down the
// table. Precomputing this at write time (webhooks/postCall.ts, alongside
// failed_transfer/no_booking_created — see db/migrateCallFlagsColumns.ts)
// lets `WHERE COALESCE(status_override, auto_status) = ?` run as a plain SQL
// predicate before the LIMIT, so pagination and filtering compose correctly.
//
// Same reasoning as migrateCallFlagsColumns.ts for doing its own raw
// call_log lookup here instead of importing db/callLog.ts or
// dashboard/callDetails.ts's deriveStatus: this migration runs during
// db/index.ts's own module initialization, and both of those modules
// (transitively) import the `db` singleton from that same still-initializing
// module — a circular import that crashes with "Cannot access 'db' before
// initialization" (hit and fixed once already for migrateCallFlagsColumns.ts).
export function migrateAutoStatusColumn(db: DatabaseSync): void {
  const columnExists = db
    .prepare(`SELECT 1 FROM pragma_table_info('elevenlabs_calls') WHERE name = 'auto_status'`)
    .get();
  if (columnExists) return;

  db.exec("BEGIN");
  try {
    db.exec(`ALTER TABLE elevenlabs_calls ADD COLUMN auto_status TEXT NOT NULL DEFAULT 'excused'`);

    const rows = db.prepare(`SELECT conversation_id, business_id FROM elevenlabs_calls`).all() as {
      conversation_id: string;
      business_id: number;
    }[];
    // Mirrors deriveStatus()'s exact precedence: a lead log takes priority
    // over a job log (a call only ever produces one or the other — see
    // db/callLog.ts), a *successful* job log means "booked", either log
    // existing at all (regardless of success) means "not_booked", and
    // neither existing means "excused".
    const findLeadLog = db.prepare(
      `SELECT 1 FROM call_log WHERE business_id = ? AND conversation_id = ? AND tool_name = 'create_lead' LIMIT 1`,
    );
    const findJobLog = db.prepare(
      `SELECT success FROM call_log WHERE business_id = ? AND conversation_id = ? AND tool_name = 'book_job' ORDER BY id DESC LIMIT 1`,
    );
    const updateStatus = db.prepare(`UPDATE elevenlabs_calls SET auto_status = ? WHERE conversation_id = ?`);

    for (const row of rows) {
      const hasLeadLog = !!findLeadLog.get(row.business_id, row.conversation_id);
      const jobLog = hasLeadLog ? undefined : (findJobLog.get(row.business_id, row.conversation_id) as { success: number } | undefined);
      let autoStatus: "booked" | "not_booked" | "excused";
      if (jobLog?.success) autoStatus = "booked";
      else if (hasLeadLog || jobLog) autoStatus = "not_booked";
      else autoStatus = "excused";
      updateStatus.run(autoStatus, row.conversation_id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
