import { requireServiceTitanConfig, stRequest, describeError } from "./httpClient";

export interface CreateLeadInput {
  customerId: string;
  locationId?: string;
  summary: string;
  isEmergency: boolean;
}

export interface CreateLeadResult {
  success: boolean;
  leadId: string | null;
}

export async function createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
  const config = requireServiceTitanConfig();
  const path = `/crm/v2/tenant/${config.tenantId}/leads`;

  // ServiceTitan requires either a Call Reason ID or a follow-up date on every
  // lead. We don't have a real scheduled date from the call (preferredTiming
  // is freeform text, not a date) — if no Call Reason ID is configured,
  // default to one business day out so the lead is never rejected for this.
  const followUpDate = config.defaultCallReasonId
    ? undefined
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const response = await stRequest<{ id: number }>(config, "POST", path, {
      data: {
        customerId: Number(input.customerId),
        locationId: input.locationId ? Number(input.locationId) : undefined,
        businessUnitId: config.defaultBusinessUnitId ? Number(config.defaultBusinessUnitId) : undefined,
        campaignId: config.defaultCampaignId ? Number(config.defaultCampaignId) : undefined,
        callReasonId: config.defaultCallReasonId ? Number(config.defaultCallReasonId) : undefined,
        jobTypeId: config.defaultJobTypeId ? Number(config.defaultJobTypeId) : undefined,
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
