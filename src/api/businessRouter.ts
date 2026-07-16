import { Router } from "express";
import crypto from "node:crypto";
import { resolveBusiness } from "../middleware/resolveBusiness";
import { requireApiSession } from "./requireApiSession";
import { requireBusinessAccess } from "../middleware/requireBusinessAccess";
import { requireApiPlatformAdmin } from "./requireApiPlatformAdmin";
import { patchCallsSchema, businessInfoSchema, generalSettingsSchema } from "./schemas";
import {
  listCallRecords,
  getCallRecord,
  updateCallStatus,
} from "../db/callRecords";
import type { CallDateRange, CallCursor } from "../db/callRecords";
import { findCreateLeadLogByConversationId, findBookJobLogByConversationId } from "../db/callLog";
import {
  isEndedEarly,
  buildCallDetailViewModel,
  buildCallHistory,
  deriveCallHandler,
  buildServiceTitanUrls,
} from "../dashboard/callDetails";
import type { CallFlags, CallStatus } from "../dashboard/callDetails";
import { computeMetrics } from "../dashboard/metrics";
import { renameBusiness } from "../db/businesses";
import type { Business } from "../db/businesses";
import {
  getRawElevenLabsSettings,
  getRawServiceTitanSettings,
  getRawOperationalSettings,
  getRawTwilioSettings,
  setBusinessSetting,
  maybeSetBusinessSetting,
  type ServiceTitanEnvironment,
  type BookingMode,
} from "../settings/store";
import { searchVoices, exploreVoices, addSharedVoice, getVoice } from "../elevenlabs/voices";
import { getAgentVoiceConfig, updateAgentVoiceConfig, generateTestAudio, TTS_MODEL_IDS } from "../elevenlabs/agents";
import { ElevenLabsNotConfiguredError } from "../elevenlabs/httpClient";
import { describeError } from "../servicetitan/httpClient";
import { voiceConfigSchema } from "./schemas";

export const apiBusinessRouter = Router({ mergeParams: true });

apiBusinessRouter.use(resolveBusiness);
apiBusinessRouter.use(requireApiSession);
apiBusinessRouter.use(requireBusinessAccess);

function parseCallRow(business: Business, record: ReturnType<typeof listCallRecords>[number]) {
  const businessId = business.id;
  const leadLog = findCreateLeadLogByConversationId(businessId, record.conversation_id);
  const jobLog = leadLog ? undefined : findBookJobLogByConversationId(businessId, record.conversation_id);
  // Precomputed once at write time (webhooks/postCall.ts) instead of parsing
  // the transcript and re-querying call_log on every row of every page load
  // — see dashboard/callDetails.ts's computeCallFlags.
  const flags: CallFlags = {
    failedTransfer: !!record.failed_transfer,
    noBookingCreated: !!record.no_booking_created,
    endedEarly: isEndedEarly(record),
  };
  const bookingLog = leadLog ?? jobLog;

  let customerName: string | null = null;
  let phone: string | null = null;
  let isEmergency: boolean | null = null;
  if (bookingLog) {
    try {
      const request = JSON.parse(bookingLog.request_json) as { name?: string; phone?: string; isEmergency?: boolean };
      customerName = request.name ?? null;
      phone = request.phone ?? null;
      isEmergency = request.isEmergency ?? null;
    } catch {
      // leave null on a malformed row rather than crash the list
    }
  }

  let leadId: string | null = null;
  let jobId: string | null = null;
  if (bookingLog?.response_json) {
    try {
      const response = JSON.parse(bookingLog.response_json) as { leadId?: string | null; jobId?: string | null };
      leadId = response.leadId ?? null;
      jobId = response.jobId ?? null;
    } catch {
      // same as above
    }
  }

  const { leadUrl, jobUrl } = buildServiceTitanUrls(businessId, leadId, jobId);
  // Precomputed at write time now too (see dashboard/callDetails.ts's
  // computeCallFlags) — this used to call deriveStatus(leadLog, jobLog)
  // directly here, but that's exactly the read-time cost that made SQL-level
  // status filtering (and therefore correct pagination) impossible.
  const autoStatus = record.auto_status as CallStatus;
  const statusOverride = (record.status_override as "booked" | "not_booked" | "excused" | null) ?? null;
  const autoCallReason = record.call_reason;
  const callReasonOverride = record.call_reason_override;

  return {
    conversationId: record.conversation_id,
    receivedAt: record.received_at,
    durationSecs: record.duration_secs,
    customerName,
    phone,
    isEmergency,
    callHandler: deriveCallHandler(record),
    status: statusOverride ?? autoStatus,
    autoStatus,
    statusOverride,
    callReason: callReasonOverride ?? autoCallReason,
    autoCallReason,
    callReasonOverride,
    isRead: !!record.is_read,
    recoveryStatus: record.recovery_status as "recovered" | "not_recovered" | null,
    leadId,
    jobId,
    leadUrl,
    jobUrl,
    flags,
  };
}

// One page of the Calls list — deliberately small enough that keyset
// pagination (below) is the normal path, not an edge case only reached at
// unrealistic call volumes.
const CALLS_PAGE_SIZE = 50;

// Opaque to the client — just base64(receivedAt + "|" + conversationId), the
// exact composite key listCallRecords' `before` cursor needs (see
// db/callRecords.ts's CallDateRange for why both fields matter). Base64
// rather than a raw "|"-joined string only so it reads as one opaque token
// in the URL rather than something that looks hand-editable.
function encodeCursor(cursor: CallCursor): string {
  return Buffer.from(`${cursor.receivedAt}|${cursor.conversationId}`, "utf8").toString("base64url");
}

function decodeCursor(raw: string): CallCursor | undefined {
  try {
    const [receivedAt, conversationId] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!receivedAt || !conversationId) return undefined;
    return { receivedAt, conversationId };
  } catch {
    return undefined;
  }
}

apiBusinessRouter.get("/calls", (req, res) => {
  const business = req.business!;
  const query = req.query as Record<string, string | undefined>;

  // Every filter here is a real SQL WHERE predicate now (db/callRecords.ts's
  // listCallRecords), evaluated before the LIMIT — the thing that actually
  // makes the cursor below correct. Filtering rows out in JS after fetching
  // a limited page (the old approach) could make a page look empty even
  // though matching rows exist further down the table.
  const range: CallDateRange = {
    from: query.from || undefined,
    to: query.to || undefined,
    before: query.cursor ? decodeCursor(query.cursor) : undefined,
    failedTransfer: query.failedTransfer === "1",
    noBookingCreated: query.noBookingCreated === "1",
    endedEarly: query.endedEarly === "1",
    isRead: query.isRead !== undefined ? query.isRead === "1" : undefined,
    recoveryStatus:
      query.recoveryStatus === undefined
        ? undefined
        : query.recoveryStatus === "null"
          ? null
          : (query.recoveryStatus as "recovered" | "not_recovered"),
    status: query.status as "booked" | "not_booked" | "excused" | undefined,
  };

  const records = listCallRecords(business.id, CALLS_PAGE_SIZE, range);
  const rows = records.map((record) => parseCallRow(business, record));

  // A full page might mean there's more; a short page means we've reached
  // the end of what matches — same "did we get a full page back" check any
  // keyset-paginated API uses, since COUNT(*) up front would cost as much as
  // the scan this pagination exists to avoid.
  const lastRecord = records[records.length - 1];
  const nextCursor =
    records.length === CALLS_PAGE_SIZE && lastRecord
      ? encodeCursor({ receivedAt: lastRecord.received_at, conversationId: lastRecord.conversation_id })
      : null;

  res.json({ calls: rows, nextCursor });
});

apiBusinessRouter.patch("/calls", (req, res) => {
  const business = req.business!;
  const parsed = patchCallsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { conversationIds, isRead, recoveryStatus, statusOverride, callReasonOverride, internalNotes } = parsed.data;
  updateCallStatus(business.id, conversationIds, { isRead, recoveryStatus, statusOverride, callReasonOverride, internalNotes });
  res.json({ success: true });
});

apiBusinessRouter.get("/calls/:conversationId", (req, res) => {
  const business = req.business!;
  const { conversationId } = req.params;
  const viewModel = buildCallDetailViewModel(business, conversationId);
  if (!viewModel) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const record = getCallRecord(business.id, conversationId)!;
  res.json({
    ...viewModel,
    durationSecs: record.duration_secs,
    isRead: !!record.is_read,
    recoveryStatus: record.recovery_status as "recovered" | "not_recovered" | null,
    internalNotes: record.internal_notes,
    audioUrl: viewModel.hasAudio ? `/b/${business.id}/calls/${conversationId}/audio` : null,
    humanRecordingUrl: viewModel.hasHumanRecording ? `/b/${business.id}/calls/${conversationId}/human-audio` : null,
    callHistory: buildCallHistory(business, record),
  });
});

apiBusinessRouter.get("/metrics", (req, res) => {
  const business = req.business!;
  const query = req.query as Record<string, string | undefined>;
  const range: CallDateRange = { from: query.from || undefined, to: query.to || undefined };
  res.json(computeMetrics(business, range));
});

apiBusinessRouter.get("/settings/business-info", (req, res) => {
  const business = req.business!;
  const st = getRawServiceTitanSettings(business.id);
  res.json({
    name: business.name,
    serviceTitanBusinessUnitId: st.businessUnitId,
    serviceTitanCampaignId: st.campaignId,
    serviceTitanJobTypeId: st.jobTypeId,
    serviceCategories: st.serviceCategories,
  });
});

apiBusinessRouter.put("/settings/business-info", (req, res) => {
  const business = req.business!;
  const parsed = businessInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;

  if (body.name) renameBusiness(business.id, body.name);
  maybeSetBusinessSetting(business.id, "servicetitan.businessUnitId", body.serviceTitanBusinessUnitId);
  maybeSetBusinessSetting(business.id, "servicetitan.campaignId", body.serviceTitanCampaignId);
  maybeSetBusinessSetting(business.id, "servicetitan.jobTypeId", body.serviceTitanJobTypeId);
  if (body.serviceCategories) {
    setBusinessSetting(business.id, "servicetitan.serviceCategories", JSON.stringify(body.serviceCategories));
  }

  res.json({ success: true });
});

// Voice/model/TTS settings are operational, not credentials — any
// business-access user can view/change them, same as Business Info, even
// though the underlying ElevenLabs API key itself is only ever entered via
// the platform-admin-only General settings below. Always reads/writes
// live against ElevenLabs rather than storing our own copy of the chosen
// voice/model, so this page can never drift from what the agent actually
// has configured (e.g. if someone changes it directly in ElevenLabs' own
// dashboard).
apiBusinessRouter.get("/settings/voices/search", async (req, res) => {
  const business = req.business!;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  try {
    const result = await searchVoices(business.id, search);
    res.json(result);
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

// "Explore" tab — ElevenLabs' full shared-voice library, not just what
// this account has already saved (see exploreVoices()'s own comment for
// why /settings/voices/search above can't be reused for this).
apiBusinessRouter.get("/settings/voices/explore", async (req, res) => {
  const business = req.business!;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  try {
    const result = await exploreVoices(business.id, search);
    res.json(result);
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

apiBusinessRouter.get("/settings/voice", async (req, res) => {
  const business = req.business!;
  try {
    const voiceConfig = await getAgentVoiceConfig(business.id);
    const currentVoice = voiceConfig ? await getVoice(business.id, voiceConfig.voiceId) : null;
    res.json({ voiceConfig, currentVoice, availableModels: TTS_MODEL_IDS });
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

apiBusinessRouter.put("/settings/voice", async (req, res) => {
  const business = req.business!;
  const parsed = voiceConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { addFromExplore, ...voiceConfig } = parsed.data;
  try {
    if (addFromExplore) {
      await addSharedVoice(business.id, addFromExplore.publicOwnerId, voiceConfig.voiceId, addFromExplore.name);
    }
    await updateAgentVoiceConfig(business.id, voiceConfig);
    res.json({ success: true });
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

// Real speech synthesis with whatever stability/speed/similarity is
// currently dialed in — unlike everything else on this page, this costs
// real ElevenLabs credits per click (confirmed: ~72KB of audio for one
// short line), so it's a deliberate button press, not something fetched
// automatically. A voice's own preview clip (used in the picker modal)
// can't show this at all, since it's always pre-rendered at that voice's
// default settings, not whatever the user has currently dragged the
// sliders to. Explore-only fields like addFromExplore are simply ignored
// here — reusing voiceConfigSchema is fine since this never adds anything
// to the account's library, just synthesizes one throwaway line.
apiBusinessRouter.post("/settings/voice/test-audio", async (req, res) => {
  const business = req.business!;
  const parsed = voiceConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  try {
    const audio = await generateTestAudio(business.id, parsed.data);
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audio);
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

// Credentials and secrets, not operational metadata like Business Info —
// only a platform admin can view or change these, and only from that
// business's own admin console (client/src/pages/AdminSettingsPage.tsx),
// not the regular per-business Settings nav any business-access user sees.
apiBusinessRouter.get("/settings/general", requireApiPlatformAdmin, (req, res) => {
  const business = req.business!;
  res.json({
    elevenLabs: getRawElevenLabsSettings(business.id),
    serviceTitan: getRawServiceTitanSettings(business.id),
    operational: getRawOperationalSettings(business.id),
    twilio: getRawTwilioSettings(business.id),
  });
});

apiBusinessRouter.put("/settings/general", requireApiPlatformAdmin, (req, res) => {
  const business = req.business!;
  const parsed = generalSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;

  maybeSetBusinessSetting(business.id, "elevenlabs.apiKey", body.elevenLabsApiKey);
  maybeSetBusinessSetting(business.id, "elevenlabs.agentId", body.elevenLabsAgentId);

  if (body.serviceTitanEnvironment) {
    setBusinessSetting(business.id, "servicetitan.environment", body.serviceTitanEnvironment as ServiceTitanEnvironment);
  }
  maybeSetBusinessSetting(business.id, "servicetitan.clientId", body.serviceTitanClientId);
  maybeSetBusinessSetting(business.id, "servicetitan.clientSecret", body.serviceTitanClientSecret);
  maybeSetBusinessSetting(business.id, "servicetitan.appKey", body.serviceTitanAppKey);
  maybeSetBusinessSetting(business.id, "servicetitan.tenantId", body.serviceTitanTenantId);
  maybeSetBusinessSetting(business.id, "servicetitan.callReasonId", body.serviceTitanCallReasonId);
  maybeSetBusinessSetting(business.id, "servicetitan.tagName", body.serviceTitanTagName);
  if (body.serviceTitanBookingMode) {
    setBusinessSetting(business.id, "servicetitan.bookingMode", body.serviceTitanBookingMode as BookingMode);
  }

  if (body.timezone) setBusinessSetting(business.id, "operational.timezone", body.timezone);
  maybeSetBusinessSetting(business.id, "operational.dashboardBaseUrl", body.dashboardBaseUrl?.replace(/\/+$/, ""));
  maybeSetBusinessSetting(business.id, "operational.toolWebhookSecret", body.toolWebhookSecret);
  maybeSetBusinessSetting(business.id, "operational.postCallWebhookSecret", body.postCallWebhookSecret);
  maybeSetBusinessSetting(business.id, "twilio.accountSid", body.twilioAccountSid);
  maybeSetBusinessSetting(business.id, "twilio.authToken", body.twilioAuthToken);

  res.json({ success: true });
});

apiBusinessRouter.post("/settings/general/generate-secret", requireApiPlatformAdmin, (req, res) => {
  const business = req.business!;
  const secret = crypto.randomBytes(24).toString("hex");
  setBusinessSetting(business.id, "operational.toolWebhookSecret", secret);
  res.json({ secret });
});
