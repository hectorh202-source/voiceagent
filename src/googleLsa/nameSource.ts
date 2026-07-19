interface ParsedLsaPayload {
  nameSource?: "servicetitan" | "caller_id" | null;
}

// Which fallback (if either) resolved a PHONE_CALL lead's name — recorded
// alongside the rest of the raw payload at ingestion time (see leads.ts's
// fetchRecentLsaLeads) rather than its own DB column, same "encode it in the
// already-stored payload, extract at read time" pattern as recordings.ts's
// extractRecordingUrl/attachments.ts's extractAttachmentUrls. Returns null
// for a MESSAGE lead (name came straight from Google, nothing to attribute),
// a lead ingested before this tracking existed (self-heals on the next poll,
// same as the name/email backfill itself), or one where no name resolved at
// all.
export function extractNameSource(rawPayloadJson: string): "servicetitan" | "caller_id" | null {
  try {
    const parsed = JSON.parse(rawPayloadJson) as ParsedLsaPayload;
    return parsed.nameSource ?? null;
  } catch {
    return null;
  }
}
