import crypto from "node:crypto";
import { deleteSetting, getSetting } from "./store";
import { attemptLogin, userCount, type User } from "../db/users";

export type AuthState = "fresh" | "needs_migration" | "ready";

export function getAuthState(): AuthState {
  if (userCount() > 0) return "ready";
  return hasLegacyAdminPassword() ? "needs_migration" : "fresh";
}

export function hasLegacyAdminPassword(): boolean {
  return getSetting("admin.passwordHash") !== null;
}

// Only used by the one-time /settings/migrate flow, to validate the old
// single shared password before converting it into the first real user
// account. Same scrypt + timingSafeEqual check the app used before
// multi-user accounts existed.
function hashLegacy(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function verifyLegacyAdminPassword(password: string): boolean {
  const salt = getSetting("admin.passwordSalt");
  const hash = getSetting("admin.passwordHash");
  if (!salt || !hash) return false;
  const candidate = Buffer.from(hashLegacy(password, salt), "hex");
  const stored = Buffer.from(hash, "hex");
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

export function clearLegacyAdminPassword(): void {
  deleteSetting("admin.passwordHash");
  deleteSetting("admin.passwordSalt");
}

export function login(email: string, password: string): { ok: true; user: User } | { ok: false } {
  return attemptLogin(email, password);
}
