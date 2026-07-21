import { db } from "./index";

export interface TwilioRecordingRow {
  business_id: number;
  call_sid: string;
  recording_sid: string | null;
  recording_path: string | null;
  status: string;
  updated_at: string;
}

const insertRequestedStmt = db.prepare(`
  INSERT OR IGNORE INTO twilio_recordings (business_id, call_sid, status)
  VALUES (@businessId, @callSid, 'requested')
`);

// Twilio retries a Status Callback delivery on anything but a fast 2xx, and
// can also send more than one "in-progress" event for the same call — this
// is the idempotency guard that keeps a slow-but-successful first attempt
// (or a genuine retry) from triggering a second real recording request.
// Returns true only the first time a given (business, callSid) pair is seen,
// via the table's own primary key rejecting the INSERT on every call after
// that.
export function claimRecordingRequest(businessId: number, callSid: string): boolean {
  const result = insertRequestedStmt.run({ businessId, callSid });
  return result.changes > 0;
}

const setCompleteStmt = db.prepare(`
  UPDATE twilio_recordings
  SET recording_sid = @recordingSid, recording_path = @recordingPath, status = 'completed', updated_at = datetime('now')
  WHERE business_id = @businessId AND call_sid = @callSid
`);

export function setRecordingComplete(businessId: number, callSid: string, recordingSid: string, recordingPath: string): void {
  setCompleteStmt.run({ businessId, callSid, recordingSid, recordingPath });
}

const getByCallSidStmt = db.prepare(`SELECT * FROM twilio_recordings WHERE business_id = ? AND call_sid = ?`);

export function getTwilioRecording(businessId: number, callSid: string): TwilioRecordingRow | undefined {
  return getByCallSidStmt.get(businessId, callSid) as TwilioRecordingRow | undefined;
}

// Platform-admin-only Call delete (see businessRouter.ts's DELETE
// /calls/:conversationId) — callers fetch the row first (for its
// recording_path, to unlink the on-disk file) before calling this.
const deleteByCallSidStmt = db.prepare(`DELETE FROM twilio_recordings WHERE business_id = ? AND call_sid = ?`);

export function deleteTwilioRecording(businessId: number, callSid: string): void {
  deleteByCallSidStmt.run(businessId, callSid);
}
