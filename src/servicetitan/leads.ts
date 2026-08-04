import { requireServiceTitanConfig, stRequest, describeError } from "./httpClient";
import { findTagTypeIdByName } from "./tags";
import { findCallReasonIdByName } from "./callReasons";
import { getBusinessSetting } from "../settings/store";

export interface CreateLeadInput {
  customerId: string;
  locationId?: string;
  summary: string;
  isEmergency: boolean;
  // Overrides the business's single default business unit/job type when a
  // matching service category was resolved (see settings/store.ts's
  // resolveServiceCategory) — falls back to the config defaults below when
  // not given, so this is fully optional.
  businessUnitId?: string;
  jobTypeId?: string;
}

export interface CreateLeadResult {
  success: boolean;
  leadId: string | null;
}

// Updates an already-created Lead's summary — used once, by the post-call
// webhook, to swap the short constructed narrative for the real AI-generated
// call summary once it's available (see webhooks/postCall.ts). This is the
// only place this app ever writes to a Lead after creating it.
//
// Unverified against the real API: going on ServiceTitan's typical CRM v2
// convention (PATCH for a partial update) rather than confirmed behavior —
// if this 404s/405s in practice, the likely fix is PUT with a full lead
// payload instead of just { summary }, or a slightly different path.
export async function updateLeadSummary(businessId: number, leadId: string, summary: string): Promise<boolean> {
  try {
    const config = requireServiceTitanConfig(businessId);
    await stRequest(config, "PATCH", `/crm/v2/tenant/${config.tenantId}/leads/${leadId}`, { data: { summary } });
    return true;
  } catch (error) {
    console.error("updateLeadSummary failed:", describeError(error));
    return false;
  }
}

export async function createLead(businessId: number, input: CreateLeadInput): Promise<CreateLeadResult> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/crm/v2/tenant/${config.tenantId}/leads`;

  // ServiceTitan requires a Campaign ID on every lead — fail with a clear,
  // actionable log line here rather than letting ServiceTitan reject the
  // request with an opaque 400.
  if (!config.defaultCampaignId) {
    console.error(
      "createLead: no Campaign ID configured (Settings → ServiceTitan → Default campaign ID) — ServiceTitan requires one on every lead",
    );
    return { success: false, leadId: null };
  }

  // Call Reason is configurable two ways, name taking priority — same
  // reasoning as tagName below (ServiceTitan's own UI doesn't surface
  // Call Reason IDs anywhere obvious, so a name-based lookup against the
  // real Call Reasons list, see servicetitan/callReasons.ts, is friendlier
  // to configure than hunting down a raw numeric ID). defaultCallReasonId
  // stays as a fallback for whoever already has one configured, or if the
  // configured name doesn't resolve to anything real (typo, deleted).
  const callReasonName = config.defaultCallReasonName;
  let callReasonId: number | null = callReasonName ? await findCallReasonIdByName(businessId, callReasonName) : null;
  if (callReasonName && !callReasonId) {
    console.error(`createLead: configured call reason name "${callReasonName}" was not found in ServiceTitan call reasons`);
  }
  if (!callReasonId && config.defaultCallReasonId) {
    callReasonId = Number(config.defaultCallReasonId);
  }

  // ServiceTitan requires either a Call Reason ID or a follow-up date on every
  // lead. We don't have a real scheduled date from the call (preferredTiming
  // is freeform text, not a date) — if no Call Reason ID resolved above,
  // default to one business day out so the lead is never rejected for this.
  const followUpDate = callReasonId ? undefined : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Tags identify leads created by this AI receptionist so the business can
  // tell at a glance (and once converted to a job) that it came from this
  // channel. Configured by name in /settings rather than by ID, since
  // ServiceTitan's own UI doesn't surface tag-type IDs anywhere.
  const tagName = getBusinessSetting(businessId, "servicetitan.tagName");
  let tagTypeId: number | null = null;
  if (tagName) {
    tagTypeId = await findTagTypeIdByName(businessId, tagName);
    if (!tagTypeId) {
      console.error(`createLead: configured tag name "${tagName}" was not found in ServiceTitan tag types`);
    }
  }

  const businessUnitId = input.businessUnitId ?? config.defaultBusinessUnitId;
  const jobTypeId = input.jobTypeId ?? config.defaultJobTypeId;

  try {
    const response = await stRequest<{ id: number }>(config, "POST", path, {
      data: {
        customerId: Number(input.customerId),
        locationId: input.locationId ? Number(input.locationId) : undefined,
        businessUnitId: businessUnitId ? Number(businessUnitId) : undefined,
        campaignId: Number(config.defaultCampaignId),
        callReasonId: callReasonId ?? undefined,
        jobTypeId: jobTypeId ? Number(jobTypeId) : undefined,
        tagTypeIds: tagTypeId ? [tagTypeId] : undefined,
        followUpDate,
        priority: input.isEmergency ? "Urgent" : "Normal",
        summary: input.summary,
      },
    });
    return { success: true, leadId: String(response.id) };
  } catch (error) {
    console.error("createLead failed:", describeError(error));
    return { success: false, leadId: null };
  }
}
