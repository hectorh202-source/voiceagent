import axios from "axios";
import type { GoogleLsaConfig } from "../settings/store";
import { getAccessToken } from "./authClient";

interface ParsedLsaPayload {
  conversations?: { messageDetails?: { attachmentUrls?: string[] } }[];
}

// Flattened in the same chronological order leads.ts already sorts
// conversations into before storing rawPayloadJson (see fetchRecentLsaLeads'
// per-lead ascending sort) — attachment 0 is always the earliest message's
// first attachment, stable across repeated requests for the same lead, so
// the client can address one by a plain numeric index.
export function extractAttachmentUrls(rawPayloadJson: string): string[] {
  try {
    const parsed = JSON.parse(rawPayloadJson) as ParsedLsaPayload;
    const urls: string[] = [];
    for (const convo of parsed.conversations ?? []) {
      for (const url of convo.messageDetails?.attachmentUrls ?? []) {
        urls.push(url);
      }
    }
    return urls;
  } catch {
    return [];
  }
}

export interface AttachmentFile {
  data: Buffer;
  contentType: string;
}

// Same bearer-token proxy pattern as recordings.ts's fetchRecordingAudio —
// the browser has no way to attach the OAuth token these URLs need, and the
// token itself shouldn't leave the server. Google's own MessageDetails.
// attachment_urls doc comment says these download "using the developer
// token," but recordings.ts's real test showed call_recording_url only
// needed the bearer access token, not a separate developer-token header;
// unconfirmed whether attachments are stricter, since no business has a real
// attachment yet to test against (see leads.ts's comment on
// LocalServicesLeadConversationRow.messageDetails.attachmentUrls) — if a
// real 401/403 ever comes back here, try adding a developer-token header
// before assuming anything deeper is wrong.
export async function fetchAttachment(config: GoogleLsaConfig, url: string): Promise<AttachmentFile> {
  const token = await getAccessToken(config);
  const response = await axios.get<ArrayBuffer>(url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "arraybuffer",
  });
  const contentType = response.headers["content-type"];
  return {
    data: Buffer.from(response.data),
    contentType: typeof contentType === "string" ? contentType : "application/octet-stream",
  };
}
