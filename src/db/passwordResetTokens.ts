import crypto from "node:crypto";
import { db } from "./index";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, industry-standard reset-link lifetime

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

const invalidateForUserStmt = db.prepare(
  `UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL`,
);
const insertStmt = db.prepare(
  `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
);

// Only ever returns the raw token once, at creation time — everything
// stored from here on is the hash. Invalidates any still-outstanding token
// for this user first, so at most one reset link is ever valid at a time
// (requesting a new one silently supersedes an older, possibly-already-
// forwarded-somewhere link).
export function createPasswordResetToken(userId: number): string {
  invalidateForUserStmt.run(userId);
  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  insertStmt.run(hashToken(rawToken), userId, expiresAt);
  return rawToken;
}

interface TokenRow {
  user_id: number;
  expires_at: string;
  used_at: string | null;
}

const lookupStmt = db.prepare(
  `SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?`,
);

function findValidToken(rawToken: string): { tokenHash: string; userId: number } | null {
  const tokenHash = hashToken(rawToken);
  const row = lookupStmt.get(tokenHash) as TokenRow | undefined;
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { tokenHash, userId: row.user_id };
}

// Read-only check — used by GET /reset-password to decide whether to show
// the "set a new password" form or an "this link is invalid/expired" page,
// without consuming the token just for having been looked at.
export function isValidResetToken(rawToken: string): boolean {
  return findValidToken(rawToken) !== null;
}

const markUsedStmt = db.prepare(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token_hash = ?`);

// The real, single-use consumption — called only from POST /reset-password.
// Returns the associated user id so the caller can set the new password and
// log them straight in, or null if the token was never valid, already used,
// or expired between the GET and this POST.
export function consumeResetToken(rawToken: string): number | null {
  const found = findValidToken(rawToken);
  if (!found) return null;
  markUsedStmt.run(found.tokenHash);
  return found.userId;
}
