import crypto from "node:crypto";
import { db } from "./index";
import { encryptNullable, decryptNullable } from "../lib/encryption";
import { lookupCallerName } from "../twilio/callerName";

// Matches call_memory.ts's own hashPhone exactly (last-10-digits, SHA-256) —
// duplicated rather than shared since call_memory.ts doesn't export it and
// this cache is intentionally a separate, global (non-per-business) table.
function hashPhone(phone: string): string {
  const lastTenDigits = phone.replace(/\D/g, "").slice(-10);
  return crypto.createHash("sha256").update(lastTenDigits).digest("hex");
}

const upsertStmt = db.prepare(`
  INSERT INTO caller_id_cache (phone_lookup_hash, caller_name, checked_at)
  VALUES (@phoneHash, @callerName, datetime('now'))
  ON CONFLICT(phone_lookup_hash) DO NOTHING
`);

const selectStmt = db.prepare(`SELECT caller_name FROM caller_id_cache WHERE phone_lookup_hash = ?`);

// One Twilio Lookup API call ($0.01, charged even on a miss — see
// twilio/callerName.ts) per phone number, ever — never re-attempted after
// the first check, regardless of whether it found a name. A cache hit
// (including a cached miss) costs nothing and is a plain local read, no
// network call at all. Global across every business, since CNAM data is a
// property of the phone number itself, not of which business's agent asked.
//
// A rare race (the same brand-new number calling two businesses at the
// exact same instant) could in principle cause one extra duplicate lookup —
// accepted as a low-cost edge case, not worth locking around.
export async function getCachedCallerName(phone: string): Promise<string | null> {
  const hash = hashPhone(phone);
  const cached = selectStmt.get(hash) as { caller_name: string | null } | undefined;
  if (cached) return decryptNullable(cached.caller_name);

  const name = await lookupCallerName(phone);
  upsertStmt.run({ phoneHash: hash, callerName: encryptNullable(name) });
  return name;
}
