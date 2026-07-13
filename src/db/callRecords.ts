import { db } from "./index";

export interface ElevenLabsCallRecord {
  conversation_id: string;
  business_id: number;
  agent_id: string | null;
  received_at: string;
  transcript_json: string | null;
  summary: string | null;
  termination_reason: string | null;
  raw_payload_json: string;
  audio_path: string | null;
}

interface CallTranscriptionEntry {
  businessId: number;
  conversationId: string;
  agentId?: string | null;
  transcriptJson?: string | null;
  summary?: string | null;
  terminationReason?: string | null;
  rawPayloadJson: string;
}

const upsertTranscriptionStmt = db.prepare(`
  INSERT INTO elevenlabs_calls (conversation_id, business_id, agent_id, transcript_json, summary, termination_reason, raw_payload_json)
  VALUES (@conversationId, @businessId, @agentId, @transcriptJson, @summary, @terminationReason, @rawPayloadJson)
  ON CONFLICT(conversation_id) DO UPDATE SET
    agent_id = excluded.agent_id,
    transcript_json = excluded.transcript_json,
    summary = excluded.summary,
    termination_reason = excluded.termination_reason,
    raw_payload_json = excluded.raw_payload_json
`);

export function upsertCallTranscription(entry: CallTranscriptionEntry): void {
  upsertTranscriptionStmt.run({
    conversationId: entry.conversationId,
    businessId: entry.businessId,
    agentId: entry.agentId ?? null,
    transcriptJson: entry.transcriptJson ?? null,
    summary: entry.summary ?? null,
    terminationReason: entry.terminationReason ?? null,
    rawPayloadJson: entry.rawPayloadJson,
  });
}

// The audio webhook can arrive before or after the transcription webhook, so
// this upserts a placeholder row if one doesn't exist yet without clobbering
// whichever half already landed.
const setAudioPathStmt = db.prepare(`
  INSERT INTO elevenlabs_calls (conversation_id, business_id, raw_payload_json, audio_path)
  VALUES (@conversationId, @businessId, '{}', @audioPath)
  ON CONFLICT(conversation_id) DO UPDATE SET audio_path = excluded.audio_path
`);

export function setCallAudioPath(businessId: number, conversationId: string, audioPath: string): void {
  setAudioPathStmt.run({ conversationId, businessId, audioPath });
}

// Scoped by business_id as well as conversation_id — this is the one lookup
// the public, unauthenticated /b/:businessId/calls/:conversationId page
// depends on for tenant isolation, since the URL itself is the only access
// control. A conversationId belonging to another business must never match
// here just because the ID happens to be correct.
export function getCallRecord(businessId: number, conversationId: string): ElevenLabsCallRecord | undefined {
  return db
    .prepare(`SELECT * FROM elevenlabs_calls WHERE conversation_id = ? AND business_id = ?`)
    .get(conversationId, businessId) as ElevenLabsCallRecord | undefined;
}

export interface CallDateRange {
  from?: string; // "YYYY-MM-DD"
  to?: string; // "YYYY-MM-DD"
}

// received_at is stored as UTC with no timezone marker (see dashboard/views.ts's
// formatCallTime), so "from"/"to" boundaries here are UTC calendar days, not
// the business's configured local day — a call right at a day boundary could
// land in the adjacent day's filter results. Acceptable for a coarse filter;
// revisit only if that mismatch becomes a real complaint.
export function listCallRecords(businessId: number, limit = 50, range: CallDateRange = {}): ElevenLabsCallRecord[] {
  const conditions = ["business_id = ?"];
  const params: (string | number)[] = [businessId];

  if (range.from) {
    conditions.push("received_at >= ?");
    params.push(`${range.from} 00:00:00`);
  }
  if (range.to) {
    conditions.push("received_at <= ?");
    params.push(`${range.to} 23:59:59`);
  }
  params.push(limit);

  return db
    .prepare(`SELECT * FROM elevenlabs_calls WHERE ${conditions.join(" AND ")} ORDER BY received_at DESC LIMIT ?`)
    .all(...params) as unknown as ElevenLabsCallRecord[];
}
