import axios from "axios";
import type { GoogleLsaConfig } from "../settings/store";
import { getAccessToken } from "./authClient";

interface ParsedLsaPayload {
  conversations?: { phoneCallDetails?: { callRecordingUrl?: string } }[];
}

// The recording URL lives inside the conversations array captured at
// ingestion time (see leads.ts's rawPayloadJson: JSON.stringify({ lead,
// conversations })), not as its own DB column — pulled back out here at read
// time rather than duplicating storage for something only ever needed when
// a "play recording" request actually comes in. Returns null (not a thrown
// error) for anything that doesn't parse or has no call recording, since
// most leads — every non-google_lsa source, and MESSAGE-type LSA leads —
// legitimately have no recording at all.
export function extractRecordingUrl(rawPayloadJson: string): string | null {
  try {
    const parsed = JSON.parse(rawPayloadJson) as ParsedLsaPayload;
    const withRecording = parsed.conversations?.find((c) => c.phoneCallDetails?.callRecordingUrl);
    return withRecording?.phoneCallDetails?.callRecordingUrl ?? null;
  } catch {
    return null;
  }
}

export interface RecordingAudio {
  data: Buffer;
  contentType: string;
}

// The recording URL itself (ads.google.com/localservicesads/attachment/...)
// requires the same OAuth bearer token as every other Google Ads API call —
// confirmed by a real scratch test (2026-07-18): a plain unauthenticated
// fetch redirects to a Google sign-in page, but `Authorization: Bearer
// <access token>` alone returns the raw audio/mpeg bytes directly, no
// developer-token or other header needed. Proxied through this server
// (rather than ever exposing the raw URL or a token to the browser) since
// the browser has no way to attach that bearer token itself, and the token
// is a real credential that shouldn't leave the server.
export async function fetchRecordingAudio(config: GoogleLsaConfig, recordingUrl: string): Promise<RecordingAudio> {
  const token = await getAccessToken(config);
  const response = await axios.get<ArrayBuffer>(recordingUrl, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "arraybuffer",
  });
  const contentType = response.headers["content-type"];
  return {
    data: Buffer.from(response.data),
    contentType: typeof contentType === "string" ? contentType : "audio/mpeg",
  };
}
