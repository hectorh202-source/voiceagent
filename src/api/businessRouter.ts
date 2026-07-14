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
import type { CallDateRange } from "../db/callRecords";
import { findCreateLeadLogByConversationId, findBookJobLogByConversationId } from "../db/callLog";
import {
  computeCallFlags,
  buildCallDetailViewModel,
  deriveStatus,
  deriveCallHandler,
  matchesBadgeFilters,
  buildServiceTitanUrls,
} from "../dashboard/callDetails";
import type { CallListFilters } from "../dashboard/callDetails";
import { computeMetrics } from "../dashboard/metrics";
import { renameBusiness } from "../db/businesses";
import type { Business } from "../db/businesses";
import {
  getRawElevenLabsSettings,
  getRawServiceTitanSettings,
  getRawOperationalSettings,
  setBusinessSetting,
  maybeSetBusinessSetting,
  type ServiceTitanEnvironment,
  type BookingMode,
} from "../settings/store";

export const apiBusinessRouter = Router({ mergeParams: true });

apiBusinessRouter.use(resolveBusiness);
apiBusinessRouter.use(requireApiSession);
apiBusinessRouter.use(requireBusinessAccess);

function parseCallRow(business: Business, record: ReturnType<typeof listCallRecords>[number]) {
  const businessId = business.id;
  const leadLog = findCreateLeadLogByConversationId(businessId, record.conversation_id);
  const jobLog = leadLog ? undefined : findBookJobLogByConversationId(businessId, record.conversation_id);
  const flags = computeCallFlags(business, record);
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
  const autoStatus = deriveStatus(leadLog, jobLog);
  const statusOverride = (record.status_override as "booked" | "not_booked" | "excused" | null) ?? null;

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
    callReason: record.call_reason,
    isRead: !!record.is_read,
    recoveryStatus: record.recovery_status as "recovered" | "not_recovered" | null,
    leadId,
    jobId,
    leadUrl,
    jobUrl,
    flags,
  };
}

apiBusinessRouter.get("/calls", (req, res) => {
  const business = req.business!;
  const query = req.query as Record<string, string | undefined>;
  const filters: CallListFilters = {
    failedTransfer: query.failedTransfer === "1",
    noBookingCreated: query.noBookingCreated === "1",
    endedEarly: query.endedEarly === "1",
    from: query.from || undefined,
    to: query.to || undefined,
  };

  const records = listCallRecords(business.id, 500, { from: filters.from, to: filters.to });
  let rows = records
    .map((record) => ({ record, row: parseCallRow(business, record) }))
    .filter(({ row }) => matchesBadgeFilters(row.flags, filters));

  if (query.isRead !== undefined) {
    const wantRead = query.isRead === "1";
    rows = rows.filter(({ row }) => row.isRead === wantRead);
  }
  if (query.recoveryStatus !== undefined) {
    const want = query.recoveryStatus === "null" ? null : query.recoveryStatus;
    rows = rows.filter(({ row }) => row.recoveryStatus === want);
  }
  if (query.status !== undefined) {
    rows = rows.filter(({ row }) => row.status === query.status);
  }

  res.json({ calls: rows.map(({ row }) => row) });
});

apiBusinessRouter.patch("/calls", (req, res) => {
  const business = req.business!;
  const parsed = patchCallsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { conversationIds, isRead, recoveryStatus, statusOverride } = parsed.data;
  updateCallStatus(business.id, conversationIds, { isRead, recoveryStatus, statusOverride });
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
    callReason: record.call_reason,
    isRead: !!record.is_read,
    recoveryStatus: record.recovery_status as "recovered" | "not_recovered" | null,
    audioUrl: viewModel.hasAudio ? `/b/${business.id}/calls/${conversationId}/audio` : null,
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

  res.json({ success: true });
});

apiBusinessRouter.post("/settings/general/generate-secret", requireApiPlatformAdmin, (req, res) => {
  const business = req.business!;
  const secret = crypto.randomBytes(24).toString("hex");
  setBusinessSetting(business.id, "operational.toolWebhookSecret", secret);
  res.json({ secret });
});
