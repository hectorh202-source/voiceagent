interface TranscriptTurn {
  tool_calls?: Array<{ tool_name?: string }>;
  tool_results?: Array<{ tool_name?: string; is_error?: boolean }>;
}

// Pure transcript parsing only — deliberately has zero dependencies (not
// even on db/callRecords.ts's types) so it can be safely imported from
// db/migrateCallFlagsColumns.ts. That migration runs during db/index.ts's
// own module initialization; importing dashboard/callDetails.ts there
// instead (which pulls in db/callLog.ts, which imports the `db` singleton
// from db/index.ts) created a real circular-import crash — the same class
// of bug already worked around once for db/migratePiiEncryption.ts. See
// dashboard/callDetails.ts's computeCallFlags, which wraps this with the
// call_log lookup that decides noBookingCreated.
export function computeCallFlagsFromTranscript(transcriptJson: string | null): {
  failedTransfer: boolean;
  hadRealActivity: boolean;
} {
  let failedTransfer = false;
  let hadRealActivity = false;
  if (transcriptJson) {
    try {
      const turns = JSON.parse(transcriptJson) as TranscriptTurn[];
      failedTransfer = turns.some((t) =>
        (t.tool_results ?? []).some((r) => r.tool_name === "transfer_to_number" && r.is_error),
      );
      // Deliberately narrow — a call that hung up before any real activity
      // (e.g. an immediate wrong-number hangup) was never going to produce a
      // booking, so it shouldn't be flagged for missing one.
      hadRealActivity = turns.some((t) => (t.tool_calls ?? []).some((c) => c.tool_name === "lookup_customer"));
    } catch {
      // malformed/unexpected transcript shape — leave flags false rather than crash
    }
  }
  return { failedTransfer, hadRealActivity };
}
