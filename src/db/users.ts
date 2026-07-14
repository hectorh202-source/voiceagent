import crypto from "node:crypto";
import { db } from "./index";

export interface User {
  id: number;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  isPlatformAdmin: boolean;
}

interface UserRow {
  id: number;
  email: string;
  password_salt: string;
  password_hash: string;
  created_at: string;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  is_platform_admin: number;
}

const FAILED_ATTEMPT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// Fixed dummy salt used to hash the submitted password when no matching user
// exists, so a login attempt for a nonexistent email costs the same scrypt
// time as a real one — avoids leaking account existence via response timing.
const DUMMY_SALT = "0".repeat(32);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lockedUntil: row.locked_until,
    isPlatformAdmin: !!row.is_platform_admin,
  };
}

const insertStmt = db.prepare(
  `INSERT INTO users (email, password_salt, password_hash, is_platform_admin) VALUES (@email, @salt, @hash, @isPlatformAdmin)`,
);
const getByEmailStmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
const getByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
const listStmt = db.prepare(`SELECT * FROM users ORDER BY id ASC`);
const countStmt = db.prepare(`SELECT COUNT(*) as count FROM users`);
const deleteStmt = db.prepare(`DELETE FROM users WHERE id = ?`);
const recordFailureStmt = db.prepare(`UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = ?`);
const lockStmt = db.prepare(`UPDATE users SET locked_until = ? WHERE id = ?`);
const resetOnSuccessStmt = db.prepare(
  `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?`,
);
const setPlatformAdminStmt = db.prepare(`UPDATE users SET is_platform_admin = ? WHERE id = ?`);

export function userCount(): number {
  return (countStmt.get() as { count: number }).count;
}

// isPlatformAdmin defaults to false — only the very first account (created
// via /settings/setup or /settings/migrate, before any other user exists to
// grant them access) is created as an admin explicitly.
export function createUser(email: string, password: string, isPlatformAdmin = false): User {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  const normalized = normalizeEmail(email);
  const info = insertStmt.run({ email: normalized, salt, hash, isPlatformAdmin: isPlatformAdmin ? 1 : 0 }) as {
    lastInsertRowid: number | bigint;
  };
  return rowToUser(getByIdStmt.get(info.lastInsertRowid) as unknown as UserRow);
}

export function setPlatformAdmin(id: number, isPlatformAdmin: boolean): void {
  setPlatformAdminStmt.run(isPlatformAdmin ? 1 : 0, id);
}

export function getUserById(id: number): User | undefined {
  const row = getByIdStmt.get(id) as unknown as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export function listUsers(): User[] {
  return (listStmt.all() as unknown as UserRow[]).map(rowToUser);
}

const deleteUserBusinessesStmt = db.prepare(`DELETE FROM user_businesses WHERE user_id = ?`);

// node:sqlite enforces foreign keys by default — deleting a user who still
// has rows in user_businesses fails outright otherwise (confirmed via a real
// FOREIGN KEY constraint failed error during live testing), so their
// business assignments must go first.
export function deleteUser(id: number): void {
  db.exec("BEGIN");
  try {
    deleteUserBusinessesStmt.run(id);
    deleteStmt.run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Single entry point for a login attempt — owns all brute-force state so
// route code never touches failed_login_count/locked_until directly. Always
// pays the same scrypt cost whether the email exists, the password is wrong,
// or the account is locked; callers must show one generic message for all
// three outcomes to avoid leaking account existence or lock state.
export function attemptLogin(email: string, password: string): { ok: true; user: User } | { ok: false } {
  const row = getByEmailStmt.get(normalizeEmail(email)) as unknown as UserRow | undefined;
  const salt = row?.password_salt ?? DUMMY_SALT;
  const candidateHash = hashPassword(password, salt);

  if (!row) return { ok: false };

  const isLocked = !!row.locked_until && new Date(row.locked_until).getTime() > Date.now();

  const candidateBuf = Buffer.from(candidateHash, "hex");
  const storedBuf = Buffer.from(row.password_hash, "hex");
  const matches = candidateBuf.length === storedBuf.length && crypto.timingSafeEqual(candidateBuf, storedBuf);

  if (isLocked) return { ok: false };

  if (!matches) {
    const newCount = row.failed_login_count + 1;
    if (newCount >= FAILED_ATTEMPT_THRESHOLD) {
      lockStmt.run(new Date(Date.now() + LOCKOUT_MS).toISOString(), row.id);
    } else {
      recordFailureStmt.run(row.id);
    }
    return { ok: false };
  }

  resetOnSuccessStmt.run(row.id);
  return { ok: true, user: rowToUser(row) };
}
