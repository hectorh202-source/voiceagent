import { requireServiceTitanConfig, stRequest, describeError } from "./httpClient";
import { findTagTypeIdByName } from "./tags";
import { getBusinessSetting } from "../settings/store";

export interface CreateJobInput {
  customerId: string;
  locationId: string | null;
  summary: string;
  // ISO UTC — passed straight through from capacity.ts's AvailabilitySlot,
  // whichever one the caller picked.
  appointmentStart: string;
  appointmentEnd: string;
}

export interface CreateJobResult {
  success: boolean;
  jobId: string | null;
}

// Updates an already-booked Job's summary — used once, by the post-call
// webhook, to swap the short constructed narrative for the real AI-generated
// call summary once it's available (see webhooks/postCall.ts), the same
// two-phase pattern already used for Leads. Confirmed against the real
// OpenAPI spec: PATCH accepting a partial { summary } body.
export async function updateJobSummary(businessId: number, jobId: string, summary: string): Promise<boolean> {
  try {
    const config = requireServiceTitanConfig(businessId);
    await stRequest(config, "PATCH", `/jpm/v2/tenant/${config.tenantId}/jobs/${jobId}`, { data: { summary } });
    return true;
  } catch (error) {
    console.error("updateJobSummary failed:", describeError(error));
    return false;
  }
}

export async function createJob(businessId: number, input: CreateJobInput): Promise<CreateJobResult> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/jpm/v2/tenant/${config.tenantId}/jobs`;

  // Unlike a Lead, ServiceTitan requires businessUnitId, jobTypeId, and a
  // real locationId on every Job, in addition to campaignId — fail with a
  // clear, actionable log line rather than letting ServiceTitan reject the
  // request with an opaque 400.
  const missing = [
    !config.defaultCampaignId && "Default campaign ID",
    !config.defaultBusinessUnitId && "Default business unit ID",
    !config.defaultJobTypeId && "Default job type ID",
    !input.locationId && "a resolved customer location",
  ].filter((v): v is string => !!v);
  if (missing.length > 0) {
    console.error(`createJob: cannot book — missing ${missing.join(", ")}`);
    return { success: false, jobId: null };
  }

  // Same tagging convention as createLead — by name, not ID.
  const tagName = getBusinessSetting(businessId, "servicetitan.tagName");
  let tagTypeId: number | null = null;
  if (tagName) {
    tagTypeId = await findTagTypeIdByName(businessId, tagName);
    if (!tagTypeId) {
      console.error(`createJob: configured tag name "${tagName}" was not found in ServiceTitan tag types`);
    }
  }

  try {
    const response = await stRequest<{ id: number }>(config, "POST", path, {
      data: {
        customerId: Number(input.customerId),
        locationId: Number(input.locationId),
        businessUnitId: Number(config.defaultBusinessUnitId),
        jobTypeId: Number(config.defaultJobTypeId),
        campaignId: Number(config.defaultCampaignId),
        // Only reached for non-emergency calls (the emergency safety net in
        // tools/bookJob.ts routes emergencies to createLead instead), so
        // there's no "Urgent" case to map here the way leads.ts has one.
        priority: "Normal",
        // Confirmed via a real 400 during live testing: "You must specify
        // Arrival Window Start/End to be able to create Job instance" —
        // required in practice despite the OpenAPI spec listing these as
        // optional/nullable. We only ever have one exact picked time (not a
        // separately-negotiated window), so the window is set to exactly
        // match the appointment itself.
        appointments: [
          {
            start: input.appointmentStart,
            end: input.appointmentEnd,
            arrivalWindowStart: input.appointmentStart,
            arrivalWindowEnd: input.appointmentEnd,
          },
        ],
        summary: input.summary,
        tagTypeIds: tagTypeId ? [tagTypeId] : undefined,
      },
    });
    return { success: true, jobId: String(response.id) };
  } catch (error) {
    console.error("createJob failed:", describeError(error));
    return { success: false, jobId: null };
  }
}
