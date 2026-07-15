import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { getBusinessSetting } from "../settings/store";
import { verifyElevenLabsSignature } from "./signature";
import { upsertCallTranscription, setCallAudioPath, setCallFlags } from "../db/callRecords";
import { findCreateLeadLogByConversationId, findBookJobLogByConversationId } from "../db/callLog";
import { buildLeadSummary } from "../servicetitan/leadSummary";
import { updateLeadSummary } from "../servicetitan/leads";
import { updateJobSummary } from "../servicetitan/jobs";
import { computeCallFlags } from "../dashboard/callDetails";
import { env } from "../config/env";

interface TranscriptTurn {
  role: string;
  message?: string;
  time_in_call_secs?: number;
  tool_calls?: unknown;
  tool_results?: unknown;
}

interface PostCallTranscriptionPayload {
  type: "post_call_transcription";
  data: {
    agent_id?: string;
    conversation_id: string;
    transcript?: TranscriptTurn[];
    analysis?: {
      transcript_summary?: string;
      // Populated only if the ElevenLabs agent has a "Data Collection" field
      // configured — see docs/elevenlabs-tools.md for the exact setup. Keyed
      // by the field's identifier; we look up "call_reason" specifically.
      data_collection_results?: Record<string, { value?: string | number | boolean | null }>;
    };
    metadata?: { termination_reason?: string; call_duration_secs?: number };
  };
}

interface PostCallAudioPayload {
  type: "post_call_audio";
  data: {
    conversation_id: string;
    full_audio: string;
  };
}

type PostCallPayload = PostCallTranscriptionPayload | PostCallAudioPayload;

const recordingsDir = path.join(path.dirname(env.DATABASE_PATH), "recordings");

// ElevenLabs conversation IDs are alphanumeric with underscores/hyphens
// (e.g. "conv_01h..."). Enforced before conversation_id is used to build a
// filesystem path below — the webhook payload is HMAC-signed, but nothing
// stops the string itself from containing "../" or similar if that ever
// changed, and this is the one place in the app where an external value
// reaches the filesystem at all.
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// ElevenLabs' payload is expected to include metadata.call_duration_secs
// directly; the transcript-timestamp fallback only matters if that field is
// ever absent (unverified until a real payload confirms the exact shape —
// see docs/elevenlabs-tools.md's Call Metrics section).
function extractDurationSecs(data: PostCallTranscriptionPayload["data"]): number | null {
  if (typeof data.metadata?.call_duration_secs === "number") return data.metadata.call_duration_secs;
  const turns = data.transcript ?? [];
  const max = turns.reduce((acc, t) => (typeof t.time_in_call_secs === "number" ? Math.max(acc, t.time_in_call_secs) : acc), 0);
  return turns.length > 0 ? max : null;
}

// Requires the ElevenLabs agent to have a Data Collection field named
// exactly "call_reason" — absent for any business that hasn't configured
// one, which is expected and handled gracefully (column stays null).
function extractCallReason(data: PostCallTranscriptionPayload["data"]): string | null {
  const entry = data.analysis?.data_collection_results?.call_reason;
  if (entry === undefined || entry.value === undefined || entry.value === null) return null;
  return typeof entry.value === "string" ? entry.value : String(entry.value);
}

// Once the real AI call summary is available, swap it in for the short
// constructed narrative used when the lead was first created (mid-call, via
// tools/createLead.ts — before this summary existed). Never throws — a
// failure here is logged and doesn't affect the webhook's response to
// ElevenLabs, since the transcript/summary itself was already received and
// stored successfully regardless of whether this follow-up ServiceTitan
// write works.
async function updateLeadWithRealSummary(
  businessId: number,
  conversationId: string,
  aiSummary: string,
): Promise<void> {
  const leadLog = findCreateLeadLogByConversationId(businessId, conversationId);
  if (!leadLog) return;

  try {
    const request = JSON.parse(leadLog.request_json) as {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      phone?: string;
    };
    const response = leadLog.response_json
      ? (JSON.parse(leadLog.response_json) as { leadId?: string | null; email?: string | null; equipmentAge?: string | null })
      : null;
    const leadId = response?.leadId;
    if (!leadId || !request.street || !request.city || !request.state || !request.zip || !request.phone) {
      return;
    }

    const summary = buildLeadSummary(businessId, {
      narrative: aiSummary,
      street: request.street,
      city: request.city,
      state: request.state,
      zip: request.zip,
      phone: request.phone,
      email: response?.email ?? null,
      equipmentAge: response?.equipmentAge ?? null,
      conversationId,
    });

    const updated = await updateLeadSummary(businessId, leadId, summary);
    if (!updated) {
      console.error(`Failed to update lead ${leadId} with real call summary for conversation ${conversationId}`);
    }
  } catch (error) {
    console.error("updateLeadWithRealSummary failed:", error);
  }
}

// Parallel to updateLeadWithRealSummary, for job-booking-mode calls — a
// given call only ever produces a Lead or a Job (book_job's own emergency
// safety net logs itself as create_lead, never both), so this and the lead
// version are mutually exclusive in practice; both are simply attempted and
// only one will ever find a matching log row.
async function updateJobWithRealSummary(
  businessId: number,
  conversationId: string,
  aiSummary: string,
): Promise<void> {
  const jobLog = findBookJobLogByConversationId(businessId, conversationId);
  if (!jobLog) return;

  try {
    const request = JSON.parse(jobLog.request_json) as {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      phone?: string;
    };
    const response = jobLog.response_json
      ? (JSON.parse(jobLog.response_json) as { jobId?: string | null; email?: string | null; equipmentAge?: string | null })
      : null;
    const jobId = response?.jobId;
    if (!jobId || !request.street || !request.city || !request.state || !request.zip || !request.phone) {
      return;
    }

    const summary = buildLeadSummary(businessId, {
      narrative: aiSummary,
      street: request.street,
      city: request.city,
      state: request.state,
      zip: request.zip,
      phone: request.phone,
      email: response?.email ?? null,
      equipmentAge: response?.equipmentAge ?? null,
      conversationId,
    });

    const updated = await updateJobSummary(businessId, jobId, summary);
    if (!updated) {
      console.error(`Failed to update job ${jobId} with real call summary for conversation ${conversationId}`);
    }
  } catch (error) {
    console.error("updateJobWithRealSummary failed:", error);
  }
}

export async function handlePostCallWebhook(req: Request, res: Response): Promise<void> {
  const business = req.business;
  if (!business) {
    res.status(404).end();
    return;
  }

  const secret = getBusinessSetting(business.id, "operational.postCallWebhookSecret");
  if (!secret) {
    res.status(503).json({ error: "Post-call webhook secret not configured. Visit /settings." });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Missing raw body" });
    return;
  }

  const sigHeader = req.header("elevenlabs-signature");
  if (!verifyElevenLabsSignature(rawBody.toString("utf8"), sigHeader, secret)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body as PostCallPayload;

  if (payload.type === "post_call_transcription") {
    const { data } = payload;
    const transcriptJson = data.transcript ? JSON.stringify(data.transcript) : null;
    upsertCallTranscription({
      conversationId: data.conversation_id,
      businessId: business.id,
      agentId: data.agent_id ?? null,
      transcriptJson,
      summary: data.analysis?.transcript_summary ?? null,
      terminationReason: data.metadata?.termination_reason ?? null,
      rawPayloadJson: JSON.stringify(payload),
      durationSecs: extractDurationSecs(data),
      callReason: extractCallReason(data),
    });

    // Computed once here (and recomputed on a webhook redelivery, same as
    // duration_secs/call_reason above) rather than on every row of every
    // Calls-list page load — see dashboard/callDetails.ts's computeCallFlags.
    const { failedTransfer, noBookingCreated } = computeCallFlags(business.id, {
      conversation_id: data.conversation_id,
      transcript_json: transcriptJson,
    });
    setCallFlags(business.id, data.conversation_id, failedTransfer, noBookingCreated);

    if (data.analysis?.transcript_summary) {
      await updateLeadWithRealSummary(business.id, data.conversation_id, data.analysis.transcript_summary);
      await updateJobWithRealSummary(business.id, data.conversation_id, data.analysis.transcript_summary);
    }
  } else if (payload.type === "post_call_audio") {
    const { data } = payload;
    if (!CONVERSATION_ID_PATTERN.test(data.conversation_id)) {
      console.warn("Rejected post_call_audio webhook with malformed conversation_id:", data.conversation_id);
      res.status(400).json({ error: "Invalid conversation_id" });
      return;
    }
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    const audioPath = path.join(recordingsDir, `${data.conversation_id}.mp3`);
    fs.writeFileSync(audioPath, Buffer.from(data.full_audio, "base64"));
    setCallAudioPath(business.id, data.conversation_id, audioPath);
  } else {
    console.warn("Unknown post-call webhook payload type:", (payload as { type?: string }).type);
  }

  res.status(200).json({ received: true });
}
