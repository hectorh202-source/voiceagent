import crypto from "node:crypto";
import { getSetting, setSetting } from "./store";

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function isAdminPasswordSet(): boolean {
  return getSetting("admin.passwordHash") !== null;
}

export function setAdminPassword(password: string): void {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  setSetting("admin.passwordSalt", salt);
  setSetting("admin.passwordHash", hash);
}

export function verifyAdminPassword(password: string): boolean {
  const salt = getSetting("admin.passwordSalt");
  const hash = getSetting("admin.passwordHash");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt);
  const candidateBuf = Buffer.from(candidate, "hex");
  const hashBuf = Buffer.from(hash, "hex");
  if (candidateBuf.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, hashBuf);
}
