import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { resolveBusiness } from "../middleware/resolveBusiness";
import { requireApiSession } from "./requireApiSession";
import { requireBusinessAccess } from "../middleware/requireBusinessAccess";
import { requireApiPlatformAdmin } from "./requireApiPlatformAdmin";
import { patchCallsSchema, businessInfoSchema, generalSettingsSchema, patchLeadsSchema } from "./schemas";
import {
  listCallRecords,
  getCallRecord,
  updateCallStatus,
  countUnreadCalls,
} from "../db/callRecords";
import type { CallDateRange, CallCursor } from "../db/callRecords";
import { listInboundLeads, getInboundLeadById, updateInboundLead, countUnreadLeads } from "../db/inboundLeads";
import { extractRecordingUrl, fetchRecordingAudio } from "../googleLsa/recordings";
import { extractAttachmentUrls, fetchAttachment } from "../googleLsa/attachments";
import { extractNameSource } from "../googleLsa/nameSource";
import type { InboundLeadFilters, InboundLeadCursor } from "../db/inboundLeads";
import { formatKeyValueDump } from "../lib/format";
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
  getRawGoogleAdsBusinessSettings,
  setBusinessSetting,
  maybeSetBusinessSetting,
  getGoogleLsaConfig,
  type ServiceTitanEnvironment,
  type BookingMode,
} from "../settings/store";
import { searchVoices, exploreVoices, addSharedVoice, getVoice } from "../elevenlabs/voices";
import { getAgentVoiceConfig, updateAgentVoiceConfig, generateTestAudio, TTS_MODEL_IDS } from "../elevenlabs/agents";
import {
  listKnowledgeBaseDocuments,
  getDependentAgents,
  createTextDocument,
  createUrlDocument,
  createFileDocument,
  deleteKnowledgeBaseDocument,
  getAgentKnowledgeBase,
  attachDocumentToAgent,
  detachDocumentFromAgent,
} from "../elevenlabs/knowledgeBase";
import { ElevenLabsNotConfiguredError } from "../elevenlabs/httpClient";
import { describeError } from "../servicetitan/httpClient";
import { voiceConfigSchema, kbTextSchema, kbUrlSchema, kbAttachSchema } from "./schemas";

export const apiBusinessRouter = Router({ mergeParams: true });

// Memory storage, not disk — ElevenLabs stays the sole source of truth for
// document content (same zero-local-caching philosophy as voices.ts), so
// nothing here needs to persist beyond the single request. Size limit
// matches ElevenLabs' own documented non-enterprise account cap (20MB) so
// an oversized upload fails fast locally instead of round-tripping there
// first.
const knowledgeBaseUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

// One page of the Leads inbox — same page size/keyset-pagination reasoning
// as CALLS_PAGE_SIZE above.
const LEADS_PAGE_SIZE = 50;

// Same opaque-cursor idea as encodeCursor/decodeCursor above, just for a
// numeric id instead of a string conversationId — kept as its own small
// pair rather than generalizing the existing one, since the two resources'
// cursors have different id types.
function encodeLeadCursor(cursor: InboundLeadCursor): string {
  return Buffer.from(`${cursor.receivedAt}|${cursor.id}`, "utf8").toString("base64url");
}

function decodeLeadCursor(raw: string): InboundLeadCursor | undefined {
  try {
    const [receivedAt, idStr] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    const id = Number(idStr);
    if (!receivedAt || !Number.isInteger(id)) return undefined;
    return { receivedAt, id };
  } catch {
    return undefined;
  }
}

function parseLeadRow(record: ReturnType<typeof listInboundLeads>[number]) {
  return {
    id: record.id,
    source: record.source,
    sourceDetail: record.source_detail,
    receivedAt: record.received_at,
    // A staff-set override always wins over whatever a polling source last
    // re-fetched — see schema.ts's comment on inbound_leads.
    name: record.name_override ?? record.name,
    phone: record.phone_override ?? record.phone,
    address: record.address_override ?? record.address,
    email: record.email_override ?? record.email,
    message: record.message,
    status: record.status,
    isRead: !!record.is_read,
  };
}

apiBusinessRouter.get("/leads", (req, res) => {
  const business = req.business!;
  const query = req.query as Record<string, string | undefined>;

  const filters: InboundLeadFilters = {
    from: query.from || undefined,
    to: query.to || undefined,
    before: query.cursor ? decodeLeadCursor(query.cursor) : undefined,
    source: query.source || undefined,
    status: query.status || undefined,
    isRead: query.isRead !== undefined ? query.isRead === "1" : undefined,
  };

  const records = listInboundLeads(business.id, LEADS_PAGE_SIZE, filters);
  const rows = records.map(parseLeadRow);

  const lastRecord = records[records.length - 1];
  const nextCursor =
    records.length === LEADS_PAGE_SIZE && lastRecord
      ? encodeLeadCursor({ receivedAt: lastRecord.received_at, id: lastRecord.id })
      : null;

  res.json({ leads: rows, nextCursor });
});

apiBusinessRouter.patch("/leads", (req, res) => {
  const business = req.business!;
  const parsed = patchLeadsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { ids, isRead, status, internalNotes, name, email, phone, address } = parsed.data;
  updateInboundLead(business.id, ids, { isRead, status, internalNotes, name, email, phone, address });
  res.json({ success: true });
});

apiBusinessRouter.get("/leads/:id", (req, res) => {
  const business = req.business!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const record = getInboundLeadById(business.id, id);
  if (!record) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  // Unlike GET /calls/:conversationId (which never exposes raw_payload_json
  // — internal/audit only there), the Leads detail view deliberately shows
  // this always: since a differently-labeled form's fields might not have
  // mapped cleanly onto name/phone/email/message, staff need a way to see
  // exactly what was actually submitted, for every lead, not just the ones
  // this app's field-matching handled well.
  let rawDump = "";
  try {
    rawDump = formatKeyValueDump(JSON.parse(record.raw_payload_json));
  } catch {
    rawDump = record.raw_payload_json;
  }
  res.json({
    ...parseLeadRow(record),
    internalNotes: record.internal_notes,
    rawDump,
    hasRecording: extractRecordingUrl(record.raw_payload_json) !== null,
    attachmentCount: extractAttachmentUrls(record.raw_payload_json).length,
    // Stale once a staff override is in effect — the badge is about where
    // the *auto* value came from, which no longer matters once a human's
    // own edit is what's actually displayed.
    nameSource: record.name_override ? null : extractNameSource(record.raw_payload_json),
  });
});

// Proxies the actual recording audio (see googleLsa/recordings.ts for why
// this can't just be a raw <audio src="..."> pointed at Google's own URL —
// it requires a bearer token the browser has no way to attach). 404s for
// anything without a recording, 503 if this business hasn't got Google LSA
// configured (credentials could be removed after a lead was already synced),
// 502 for a real request failure — same three-way split every other
// external-API route in this file already uses.
apiBusinessRouter.get("/leads/:id/recording", async (req, res) => {
  const business = req.business!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const record = getInboundLeadById(business.id, id);
  if (!record) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const recordingUrl = extractRecordingUrl(record.raw_payload_json);
  if (!recordingUrl) {
    res.status(404).json({ error: "No recording available for this lead" });
    return;
  }
  const config = getGoogleLsaConfig(business.id);
  if (!config) {
    res.status(503).json({ error: "Google LSA is not configured for this business" });
    return;
  }
  try {
    const audio = await fetchRecordingAudio(config, recordingUrl);
    res.set("Content-Type", audio.contentType);
    res.send(audio.data);
  } catch (error) {
    res.status(502).json({ error: describeError(error) });
  }
});

// Same proxy reasoning as GET /leads/:id/recording — attachment_urls needs
// the same bearer token. :index addresses one attachment out of the
// (possibly several, across possibly several messages) flattened list
// extractAttachmentUrls returns for this lead — see attachmentCount on
// GET /leads/:id, which tells the client how many indices exist.
apiBusinessRouter.get("/leads/:id/attachments/:index", async (req, res) => {
  const business = req.business!;
  const id = Number(req.params.id);
  const index = Number(req.params.index);
  if (!Number.isInteger(id) || !Number.isInteger(index) || index < 0) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const record = getInboundLeadById(business.id, id);
  if (!record) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const url = extractAttachmentUrls(record.raw_payload_json)[index];
  if (!url) {
    res.status(404).json({ error: "No attachment at that index" });
    return;
  }
  const config = getGoogleLsaConfig(business.id);
  if (!config) {
    res.status(503).json({ error: "Google LSA is not configured for this business" });
    return;
  }
  try {
    const file = await fetchAttachment(config, url);
    res.set("Content-Type", file.contentType);
    res.send(file.data);
  } catch (error) {
    res.status(502).json({ error: describeError(error) });
  }
});

// Powers AppShell.tsx's sidebar unread badges (Calls/Leads), Gmail-style —
// a single lightweight endpoint rather than making the sidebar infer counts
// from the paginated list queries, which only ever hold one page of rows.
apiBusinessRouter.get("/unread-counts", (req, res) => {
  const business = req.business!;
  res.json({
    calls: countUnreadCalls(business.id),
    leads: countUnreadLeads(business.id),
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

// Knowledge Base — a growing content library non-admin staff would
// plausibly manage regularly, not a rarely-touched config field, so this
// gets the same requireBusinessAccess-only gating as Voices above rather
// than the requireApiPlatformAdmin gate General Settings uses below (the
// ElevenLabs API key itself stays admin-only there; this only manages
// documents on top of it). See docs/knowledge-base.md.
apiBusinessRouter.get("/settings/knowledge-base", async (req, res) => {
  const business = req.business!;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  try {
    const [list, attached] = await Promise.all([
      listKnowledgeBaseDocuments(business.id, { search, cursor }),
      getAgentKnowledgeBase(business.id),
    ]);
    const attachedIds = new Set(attached.map((entry) => entry.id));
    res.json({
      documents: list.documents.map((doc) => ({ ...doc, attached: attachedIds.has(doc.id) })),
      hasMore: list.hasMore,
      nextCursor: list.nextCursor,
    });
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

// Combined with dependent-agents so the client can show a real warning
// ("also used by 2 other agents") before a delete, in one request.
apiBusinessRouter.get("/settings/knowledge-base/:id/dependent-agents", async (req, res) => {
  const business = req.business!;
  try {
    const dependentAgents = await getDependentAgents(business.id, req.params.id);
    res.json({ dependentAgents });
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

apiBusinessRouter.post("/settings/knowledge-base/text", async (req, res) => {
  const business = req.business!;
  const parsed = kbTextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  try {
    const document = await createTextDocument(business.id, parsed.data);
    res.json({ document });
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

apiBusinessRouter.post("/settings/knowledge-base/url", async (req, res) => {
  const business = req.business!;
  const parsed = kbUrlSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  try {
    const document = await createUrlDocument(business.id, parsed.data);
    res.json({ document });
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

apiBusinessRouter.post("/settings/knowledge-base/file", knowledgeBaseUpload.single("file"), async (req, res) => {
  const business = req.business!;
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  try {
    const name = typeof req.body.name === "string" && req.body.name.trim() ? req.body.name.trim() : undefined;
    const document = await createFileDocument(business.id, {
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      name,
    });
    res.json({ document });
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

apiBusinessRouter.delete("/settings/knowledge-base/:id", async (req, res) => {
  const business = req.business!;
  const force = req.query.force === "1";
  try {
    await deleteKnowledgeBaseDocument(business.id, req.params.id, force);
    res.json({ success: true });
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

apiBusinessRouter.put("/settings/knowledge-base/:id/attach", async (req, res) => {
  const business = req.business!;
  const parsed = kbAttachSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  try {
    await attachDocumentToAgent(business.id, { id: req.params.id, ...parsed.data, createdAtUnixSecs: null, updatedAtUnixSecs: null, sizeBytes: null });
    res.json({ success: true });
  } catch (error) {
    const status = error instanceof ElevenLabsNotConfiguredError ? 503 : 502;
    const message = error instanceof ElevenLabsNotConfiguredError ? error.message : describeError(error);
    res.status(status).json({ error: message });
  }
});

apiBusinessRouter.delete("/settings/knowledge-base/:id/attach", async (req, res) => {
  const business = req.business!;
  try {
    await detachDocumentFromAgent(business.id, req.params.id);
    res.json({ success: true });
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
    googleAds: getRawGoogleAdsBusinessSettings(business.id),
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
  maybeSetBusinessSetting(business.id, "operational.twilioPhoneNumber", body.twilioPhoneNumber);
  maybeSetBusinessSetting(business.id, "operational.leadIntakeWebhookSecret", body.leadIntakeWebhookSecret);
  maybeSetBusinessSetting(business.id, "googleAds.customerId", body.googleAdsCustomerId);
  maybeSetBusinessSetting(business.id, "googleAds.refreshToken", body.googleAdsRefreshToken);
  // Checkbox-backed, not a secret — same "always write, no blank state to
  // distinguish from unchanged" reasoning as serviceTitanEnvironment above.
  if (body.dynamicMemoryEnabled !== undefined) {
    setBusinessSetting(business.id, "operational.dynamicMemoryEnabled", body.dynamicMemoryEnabled ? "true" : "false");
  }

  res.json({ success: true });
});

apiBusinessRouter.post("/settings/general/generate-secret", requireApiPlatformAdmin, (req, res) => {
  const business = req.business!;
  const secret = crypto.randomBytes(24).toString("hex");
  setBusinessSetting(business.id, "operational.toolWebhookSecret", secret);
  res.json({ secret });
});

apiBusinessRouter.post("/settings/general/generate-lead-intake-secret", requireApiPlatformAdmin, (req, res) => {
  const business = req.business!;
  const secret = crypto.randomBytes(24).toString("hex");
  setBusinessSetting(business.id, "operational.leadIntakeWebhookSecret", secret);
  res.json({ secret });
});
