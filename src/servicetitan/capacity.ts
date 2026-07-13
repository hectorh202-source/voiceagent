import { requireServiceTitanConfig, stRequest } from "./httpClient";
import { getAgentTimezone } from "../settings/store";

export interface AvailabilitySlot {
  // ISO UTC — safe to pass straight through to createJob()'s appointment
  // fields if the caller picks this slot, no reformatting needed.
  start: string;
  end: string;
  // Human-readable in the business's configured timezone, for the agent to
  // read aloud (e.g. "Tuesday, July 15 at 2:00 PM").
  label: string;
}

export interface AvailabilityResult {
  hasNearTermAvailability: boolean;
  note: string;
  // Only populated with real bookable windows when the caller actually
  // wants them (job-booking mode) — empty for the default lead-mode path,
  // which never needs an exact slot.
  slots: AvailabilitySlot[];
}

interface CapacityAvailability {
  startUtc: string;
  endUtc: string;
  isAvailable: boolean;
}

function formatSlotLabel(startUtc: string, businessId: number): string {
  const date = new Date(startUtc);
  const timeZone = getAgentTimezone(businessId);
  const datePart = date.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" });
  const timePart = date.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  return `${datePart} at ${timePart}`;
}

// Confirmed via a real 400 during live testing: "Invalid request. The
// maximum allowed range is 14 days." Clamp rather than let a wider request
// (e.g. an agent asking about "the next few weeks") fail outright.
const MAX_RANGE_DAYS = 14;

export async function checkAvailability(
  businessId: number,
  startDate: string,
  endDate: string,
): Promise<AvailabilityResult> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/dispatch/v2/tenant/${config.tenantId}/capacity`;

  const maxEnd = new Date(new Date(startDate).getTime() + MAX_RANGE_DAYS * 24 * 60 * 60 * 1000);
  const clampedEndDate = new Date(endDate) > maxEnd ? maxEnd.toISOString() : endDate;

  try {
    const response = await stRequest<{ availabilities?: CapacityAvailability[] }>(config, "POST", path, {
      data: {
        startsOnOrAfter: startDate,
        endsOnOrBefore: clampedEndDate,
        businessUnitIds: config.defaultBusinessUnitId ? [Number(config.defaultBusinessUnitId)] : undefined,
        jobTypeId: config.defaultJobTypeId ? Number(config.defaultJobTypeId) : undefined,
        // No skill-based scheduling in use today — required by the API but
        // always false for this integration.
        skillBasedAvailability: false,
      },
    });
    const availabilities = response.availabilities ?? [];
    const hasAvailability = availabilities.some((slot) => slot.isAvailable);

    const slots = availabilities
      .filter((slot) => slot.isAvailable)
      .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
      .slice(0, 3)
      .map((slot) => ({
        start: slot.startUtc,
        end: slot.endUtc,
        label: formatSlotLabel(slot.startUtc, businessId),
      }));

    return {
      hasNearTermAvailability: hasAvailability,
      note: hasAvailability
        ? "We generally have appointments available in that window."
        : "That window looks tight, but a team member will confirm exact timing.",
      slots,
    };
  } catch {
    return {
      hasNearTermAvailability: true,
      note: "A team member will confirm exact timing when they call you back.",
      slots: [],
    };
  }
}
