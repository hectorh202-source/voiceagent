import { requireServiceTitanConfig, stRequest } from "./httpClient";

export interface AvailabilityResult {
  hasNearTermAvailability: boolean;
  note: string;
}

export async function checkAvailability(
  businessId: number,
  startDate: string,
  endDate: string,
): Promise<AvailabilityResult> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/dispatch/v2/tenant/${config.tenantId}/capacity`;

  try {
    const response = await stRequest<{ availabilities?: { isAvailable: boolean }[] }>(config, "POST", path, {
      data: {
        startsOnOrAfter: startDate,
        endsOnOrBefore: endDate,
        businessUnitIds: config.defaultBusinessUnitId ? [Number(config.defaultBusinessUnitId)] : undefined,
        jobTypeId: config.defaultJobTypeId ? Number(config.defaultJobTypeId) : undefined,
        // No skill-based scheduling in use today — required by the API but
        // always false for this integration.
        skillBasedAvailability: false,
      },
    });
    const hasAvailability = (response.availabilities ?? []).some((slot) => slot.isAvailable);
    return {
      hasNearTermAvailability: hasAvailability,
      note: hasAvailability
        ? "We generally have appointments available in that window."
        : "That window looks tight, but a team member will confirm exact timing.",
    };
  } catch {
    return {
      hasNearTermAvailability: true,
      note: "A team member will confirm exact timing when they call you back.",
    };
  }
}
