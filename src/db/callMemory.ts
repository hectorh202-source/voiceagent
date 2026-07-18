import crypto from "node:crypto";
import { db } from "./index";
import { encryptNullable, decryptNullable } from "../lib/encryption";

// Matches this app's other last-10-digits normalization (e.g.
// twilio/pollCalls.ts's lastTenDigits()) so "+19125551234", "9125551234",
// and "(912) 555-1234" all hash identically.
function hashPhone(phone: string): string {
  const lastTenDigits = phone.replace(/\D/g, "").slice(-10);
  return crypto.createHash("sha256").update(lastTenDigits).digest("hex");
}

export interface CallMemory {
  lastSummary: string | null;
  lastCallAt: string;
  callCount: number;
}

interface CallMemoryRow {
  last_summary: string | null;
  last_call_at: string;
  call_count: number;
}

const upsertStmt = db.prepare(`
  INSERT INTO call_memory (business_id, phone_lookup_hash, last_summary, last_call_at, call_count)
  VALUES (@businessId, @phoneHash, @summary, datetime('now'), 1)
  ON CONFLICT(business_id, phone_lookup_hash) DO UPDATE SET
    last_summary = excluded.last_summary,
    last_call_at = excluded.last_call_at,
    call_count = call_memory.call_count + 1,
    updated_at = datetime('now')
`);

// Called from webhooks/postCall.ts once a call's real AI summary is known
// (mirrors upsertCallTranscription()'s own upsert-on-conflict shape) — not
// on the live-call path, so this can use the same "never throws, logged
// only" style the caller already wraps it in, rather than the fail-open
// guarantee the personalization webhook (Stage 2, not yet built) needs.
export function upsertCallMemory(businessId: number, phone: string, summary: string): void {
  upsertStmt.run({
    businessId,
    phoneHash: hashPhone(phone),
    summary: encryptNullable(summary),
  });
}

// Called from the (Stage 0-blocked) personalization webhook — must stay
// fast, since it sits on the live call-answering path. A missing row is a
// normal, expected case (first-time caller), not an error.
export function getCallMemory(businessId: number, phone: string): CallMemory | undefined {
  const row = db
    .prepare(`SELECT last_summary, last_call_at, call_count FROM call_memory WHERE business_id = ? AND phone_lookup_hash = ?`)
    .get(businessId, hashPhone(phone)) as CallMemoryRow | undefined;
  if (!row) return undefined;
  return {
    lastSummary: decryptNullable(row.last_summary),
    lastCallAt: row.last_call_at,
    callCount: row.call_count,
  };
}
