import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { getBusinessSetting, isDynamicMemoryEnabled, getTwilioConfig } from "../settings/store";
import { verifyElevenLabsSignature } from "./signature";
import { upsertCallTranscription, setCallAudioPath, setCallDerivedFields } from "../db/callRecords";
import {
  findCreateLeadLogByConversationId,
  findBookJobLogByConversationId,
  findLookupCustomerLogByConversationId,
  logToolCall,
} from "../db/callLog";
import { buildLeadSummary } from "../servicetitan/leadSummary";
import { updateLeadSummary } from "../servicetitan/leads";
import { updateJobSummary } from "../servicetitan/jobs";
import { computeCallFlags } from "../dashboard/callDetails";
import { upsertCallMemory } from "../db/callMemory";
import { env } from "../config/env";
import { getCallFromNumber } from "../twilio/httpClient";
import { lookupCustomerByPhone } from "../servicetitan/customers";
import { getCachedCallerName } from "../db/callerIdCache";
import type { Business } from "../db/businesses";

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
    metadata?: {
      termination_reason?: string;
      call_duration_secs?: number;
      // Confirmed via a real payload: the underlying Twilio Call SID for
      // this conversation's inbound leg — present whenever the call came in
      // over ElevenLabs' native telephony (Twilio) integration. This is
      // what lets the human-portion recording (see twilio/recordings.ts,
      // webhooks/twilio.ts) be joined back to the right call, regardless of
      // whether the Twilio recording pipeline or this webhook lands first.
      phone_call?: { call_sid?: string };
    };
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

// Requires the ElevenLabs agent to have a Data Collection field named
// exactly "sentiment_score", type Integer — see docs/elevenlabs-tools.md's
// Call Sentiment setup. 1 (very frustrated) through 5 (very happy). Absent
// for any business that hasn't configured one (expected, handled gracefully
// — column stays null), and also null if the model ever returns something
// outside the real 1-5 range (defensive: the field's own description
// constrains this, but nothing stops a redelivered/edge-case payload from
// carrying a stray value, and a wrong-but-plausible number silently stored
// as a real score would be worse than an honest null).
function extractSentimentScore(data: PostCallTranscriptionPayload["data"]): number | null {
  const entry = data.analysis?.data_collection_results?.sentiment_score;
  if (entry === undefined || entry.value === undefined || entry.value === null) return null;
  const num = typeof entry.value === "number" ? entry.value : Number(entry.value);
  if (!Number.isInteger(num) || num < 1 || num > 5) return null;
  return num;
}

function extractTwilioCallSid(data: PostCallTranscriptionPayload["data"]): string | null {
  const sid = data.metadata?.phone_call?.call_sid;
  return typeof sid === "string" && sid.length > 0 ? sid : null;
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

    // Reuses request.phone already parsed/validated above — no new field
    // extraction needed (the post-call payload's own metadata.phone_call
    // object only ever carries a call_sid, not a phone number). Gated by
    // the same opt-in toggle tools/lookupCustomer.ts checks on the read
    // side, so no memory is ever written for a business that hasn't
    // enabled this — see docs/dynamic-memory.md.
    if (isDynamicMemoryEnabled(businessId)) {
      upsertCallMemory(businessId, request.phone, aiSummary);
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

    // See updateLeadWithRealSummary's identical comment above.
    if (isDynamicMemoryEnabled(businessId)) {
      upsertCallMemory(businessId, request.phone, aiSummary);
    }
  } catch (error) {
    console.error("updateJobWithRealSummary failed:", error);
  }
}

// Fallback for a call where lookup_customer never fired at all — a real,
// observed LLM-reliability gap (the agent sometimes just skips its "always
// call this first" instruction, independent of call length or the
// conversationId dynamic-variable wiring, both confirmed working correctly
// elsewhere) rather than anything this app's code controls. Pulls the
// caller's number straight from Twilio's own Call resource — ground truth,
// unaffected by what the agent did or didn't do — then runs the exact same
// ServiceTitan/Caller-ID fallback lookup_customer itself would have (see
// tools/lookupCustomer.ts). Writes a real lookup_customer-shaped call_log
// row via logToolCall (same call a live tool invocation makes, conversation_id
// included), so the existing resolveLookupCustomerFallback() read path
// picks it up automatically — no new read-side code needed.
//
// Never throws — runs after the call's own data is already safely stored,
// so a failure here only ever means a still-missing customer name, never a
// broken webhook response to ElevenLabs.
//
// Takes conversationId/twilioCallSid directly (not the raw webhook payload)
// so this is equally callable from a one-off retroactive sweep over already-
// stored elevenlabs_calls rows, not just the live webhook — every check
// below is already a no-op for a call that doesn't need this, so a sweep
// can safely call this for every existing call without its own filtering.
export async function backfillMissingCustomerInfoFromTwilio(
  business: Business,
  conversationId: string,
  twilioCallSid: string | null,
): Promise<void> {
  try {
    if (!twilioCallSid) return;
    if (findLookupCustomerLogByConversationId(business.id, conversationId)) return;

    const leadLog = findCreateLeadLogByConversationId(business.id, conversationId);
    const jobLog = leadLog ? undefined : findBookJobLogByConversationId(business.id, conversationId);
    const bookingLog = leadLog ?? jobLog;
    if (bookingLog) {
      try {
        const request = JSON.parse(bookingLog.request_json) as { name?: string; phone?: string };
        if (request.name && request.phone) return; // already fine, nothing to fill
      } catch {
        // malformed stored JSON — fall through and attempt the backfill anyway
      }
    }

    const twilioConfig = getTwilioConfig();
    if (!twilioConfig) return;

    const phone = await getCallFromNumber(twilioConfig, twilioCallSid);
    if (!phone) return;

    let result: { found: boolean; customerId: string | null; locationId: string | null; name: string | null; address: string | null; email: string | null; equipmentAge: string | null } = {
      found: false,
      customerId: null,
      locationId: null,
      name: null,
      address: null,
      email: null,
      equipmentAge: null,
    };
    try {
      result = await lookupCustomerByPhone(business.id, phone);
    } catch (error) {
      console.error("backfillMissingCustomerInfoFromTwilio: ServiceTitan lookup failed:", error);
    }

    let callerIdName: string | null = null;
    if (!result.found) {
      try {
        callerIdName = await getCachedCallerName(phone);
      } catch (error) {
        console.error("backfillMissingCustomerInfoFromTwilio: Caller ID lookup failed:", error);
      }
    }

    logToolCall({
      businessId: business.id,
      toolName: "lookup_customer",
      phone,
      request: { phone, conversationId, backfilledFromTwilio: true },
      response: { ...result, lastCallSummary: null, callerIdName },
      success: true,
    });
  } catch (error) {
    console.error("backfillMissingCustomerInfoFromTwilio failed:", error);
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
      twilioCallSid: extractTwilioCallSid(data),
      sentimentScore: extractSentimentScore(data),
    });

    // Computed once here (and recomputed on a webhook redelivery, same as
    // duration_secs/call_reason above) rather than on every row of every
    // Calls-list page load — see dashboard/callDetails.ts's computeCallFlags.
    const { failedTransfer, noBookingCreated, autoStatus } = computeCallFlags(business.id, {
      conversation_id: data.conversation_id,
      transcript_json: transcriptJson,
    });
    setCallDerivedFields(business.id, data.conversation_id, failedTransfer, noBookingCreated, autoStatus);

    await backfillMissingCustomerInfoFromTwilio(business, data.conversation_id, extractTwilioCallSid(data));

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
