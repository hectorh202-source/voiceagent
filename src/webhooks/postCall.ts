import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { getBusinessSetting } from "../settings/store";
import { verifyElevenLabsSignature } from "./signature";
import { upsertCallTranscription, setCallAudioPath } from "../db/callRecords";
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

export function handlePostCallWebhook(req: Request, res: Response): void {
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
