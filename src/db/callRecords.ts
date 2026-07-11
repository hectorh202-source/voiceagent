import { db } from "./index";

export interface ElevenLabsCallRecord {
  conversation_id: string;
  agent_id: string | null;
  received_at: string;
  transcript_json: string | null;
  summary: string | null;
  termination_reason: string | null;
  raw_payload_json: string;
  audio_path: string | null;
}

interface CallTranscriptionEntry {
  conversationId: string;
  agentId?: string | null;
  transcriptJson?: string | null;
  summary?: string | null;
  terminationReason?: string | null;
  rawPayloadJson: string;
}

const upsertTranscriptionStmt = db.prepare(`
  INSERT INTO elevenlabs_calls (conversation_id, agent_id, transcript_json, summary, termination_reason, raw_payload_json)
  VALUES (@conversationId, @agentId, @transcriptJson, @summary, @terminationReason, @rawPayloadJson)
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
  INSERT INTO elevenlabs_calls (conversation_id, raw_payload_json, audio_path)
  VALUES (@conversationId, '{}', @audioPath)
  ON CONFLICT(conversation_id) DO UPDATE SET audio_path = excluded.audio_path
`);

export function setCallAudioPath(conversationId: string, audioPath: string): void {
  setAudioPathStmt.run({ conversationId, audioPath });
}

export function getCallRecord(conversationId: string): ElevenLabsCallRecord | undefined {
  return db.prepare(`SELECT * FROM elevenlabs_calls WHERE conversation_id = ?`).get(conversationId) as
    | ElevenLabsCallRecord
    | undefined;
}
