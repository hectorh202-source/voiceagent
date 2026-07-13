import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { getBusinessSetting } from "../settings/store";
import { verifyElevenLabsSignature } from "./signature";
import { upsertCallTranscription, setCallAudioPath } from "../db/callRecords";
import { findCreateLeadLogByConversationId } from "../db/callLog";
import { buildLeadSummary } from "../servicetitan/leadSummary";
import { updateLeadSummary } from "../servicetitan/leads";
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
    analysis?: { transcript_summary?: string };
    metadata?: { termination_reason?: string };
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
    upsertCallTranscription({
      conversationId: data.conversation_id,
      businessId: business.id,
      agentId: data.agent_id ?? null,
      transcriptJson: data.transcript ? JSON.stringify(data.transcript) : null,
      summary: data.analysis?.transcript_summary ?? null,
      terminationReason: data.metadata?.termination_reason ?? null,
      rawPayloadJson: JSON.stringify(payload),
    });

    if (data.analysis?.transcript_summary) {
      await updateLeadWithRealSummary(business.id, data.conversation_id, data.analysis.transcript_summary);
    }
  } else if (payload.type === "post_call_audio") {
    const { data } = payload;
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
