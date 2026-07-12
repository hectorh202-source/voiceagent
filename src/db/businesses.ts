import { db } from "./index";

export interface Business {
  id: number;
  name: string;
  createdAt: string;
}

interface BusinessRow {
  id: number;
  name: string;
  created_at: string;
}

function rowToBusiness(row: BusinessRow): Business {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

const insertStmt = db.prepare(`INSERT INTO businesses (name) VALUES (?)`);
const getByIdStmt = db.prepare(`SELECT * FROM businesses WHERE id = ?`);
const listStmt = db.prepare(`SELECT * FROM businesses ORDER BY id ASC`);
const renameStmt = db.prepare(`UPDATE businesses SET name = ? WHERE id = ?`);

export function createBusiness(name: string): Business {
  const info = insertStmt.run(name) as { lastInsertRowid: number | bigint };
  return rowToBusiness(getByIdStmt.get(info.lastInsertRowid) as unknown as BusinessRow);
}

export function getBusinessById(id: number): Business | undefined {
  const row = getByIdStmt.get(id) as unknown as BusinessRow | undefined;
  return row ? rowToBusiness(row) : undefined;
}

export function listBusinesses(): Business[] {
  return (listStmt.all() as unknown as BusinessRow[]).map(rowToBusiness);
}

export function renameBusiness(id: number, name: string): void {
  renameStmt.run(name, id);
}
