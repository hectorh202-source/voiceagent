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

// The agent sends bare "YYYY-MM-DD" dates (e.g. asking about one specific
// day), which parse as midnight UTC. Left as-is, a same-day request (e.g.
// startDate === endDate === "2026-08-10") turns into a zero-width window —
// startsOnOrAfter and endsOnOrBefore both midnight of the same instant —
// which ServiceTitan can never return availability for regardless of real
// capacity. Confirmed via real production logs: every single/narrow-day
// request came back empty while the same day inside a wider window
// correctly returned slots. Expanding a date-only end boundary to the last
// instant of that day fixes this without affecting requests that already
// carry a real time component.
function endOfDayIfDateOnly(dateStr: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T23:59:59.999Z` : dateStr;
}

export async function checkAvailability(
  businessId: number,
  startDate: string,
  endDate: string,
  // Overrides the business's single default business unit/job type when a
  // matching job type was resolved live by name (see
  // servicetitan/jobTypes.ts's resolveJobTypeOverrides) — falls back to the
  // config defaults when not given.
  overrides: { businessUnitId?: string; jobTypeId?: string } = {},
): Promise<AvailabilityResult> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/dispatch/v2/tenant/${config.tenantId}/capacity`;

  const businessUnitId = overrides.businessUnitId ?? config.defaultBusinessUnitId;
  const jobTypeId = overrides.jobTypeId ?? config.defaultJobTypeId;

  const normalizedEndDate = endOfDayIfDateOnly(endDate);
  const maxEnd = new Date(new Date(startDate).getTime() + MAX_RANGE_DAYS * 24 * 60 * 60 * 1000);
  const clampedEndDate = new Date(normalizedEndDate) > maxEnd ? maxEnd.toISOString() : normalizedEndDate;

  try {
    const response = await stRequest<{ availabilities?: CapacityAvailability[] }>(config, "POST", path, {
      data: {
        startsOnOrAfter: startDate,
        endsOnOrBefore: clampedEndDate,
        businessUnitIds: businessUnitId ? [Number(businessUnitId)] : undefined,
        jobTypeId: jobTypeId ? Number(jobTypeId) : undefined,
        // Turned on (2026-08-07) to test whether skill-aware matching
        // surfaces capacity the non-skill-based calculation was missing
        // (e.g. a real case where Saturday showed no availability under the
        // default calculation) — was hardcoded false before. Revisit if
        // this turns out to make results narrower/worse instead of better.
        skillBasedAvailability: true,
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
