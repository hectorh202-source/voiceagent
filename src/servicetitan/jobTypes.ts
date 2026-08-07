import { requireServiceTitanConfig, stRequest } from "./httpClient";

interface STJobType {
  id: number;
  name: string;
  active: boolean;
  // Confirmed via the real OpenAPI spec (Jpm.V2.JobTypeResponse) — every job
  // type already carries the business unit(s) it belongs to, which is what
  // makes a live name lookup self-sufficient: resolving a job type by name
  // also resolves its business unit, with nothing extra to configure.
  businessUnitIds: number[];
}

export interface ResolvedJobType {
  jobTypeId: number;
  // First associated business unit, if any — a job type can technically
  // list more than one, but every caller here only ever needs a single
  // businessUnitId override (same shape createLead/createJob/checkAvailability
  // already expect), so the first is as good a choice as any.
  businessUnitId: number | null;
}

// Replaces the old static Service Categories settings table — instead of a
// business having to hand-map category names to business unit/job type IDs
// (and keep that mapping in sync whenever ServiceTitan changes), the AI
// agent's captured service type is matched live against ServiceTitan's own
// real, current job types on every call. No caching: booking calls are
// infrequent enough that an extra read is cheap, and it means a renamed or
// newly-added job type in ServiceTitan is picked up immediately.
// Case-insensitive exact match only (no fuzzy matching) — same reasoning as
// findTagTypeIdByName/findCallReasonIdByName elsewhere in this app: a wrong
// fuzzy match silently books the wrong kind of job, which is worse than
// falling through to the business's configured default.
export async function findJobTypeByName(businessId: number, name: string): Promise<ResolvedJobType | null> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/jpm/v2/tenant/${config.tenantId}/job-types`;

  try {
    const result = await stRequest<{ data: STJobType[] }>(config, "GET", path, {
      params: { name, active: true, pageSize: 200 },
    });
    const normalized = name.trim().toLowerCase();
    const match = (result.data ?? []).find((jobType) => jobType.name.trim().toLowerCase() === normalized);
    if (!match) return null;
    return {
      jobTypeId: match.id,
      businessUnitId: match.businessUnitIds?.[0] ?? null,
    };
  } catch {
    return null;
  }
}

// Thin convenience wrapper matching the exact {businessUnitId?, jobTypeId?}
// string-typed shape createLead/createJob/checkAvailability all expect
// (same shape the old settings/store.ts's resolveServiceCategory returned)
// — {} for "no override, use this business's configured default" whenever
// no service type was captured on the call or nothing in ServiceTitan
// matches it by name.
export async function resolveJobTypeOverrides(
  businessId: number,
  serviceType: string | undefined,
): Promise<{ businessUnitId?: string; jobTypeId?: string }> {
  if (!serviceType) return {};
  const match = await findJobTypeByName(businessId, serviceType);
  if (!match) return {};
  return {
    jobTypeId: String(match.jobTypeId),
    businessUnitId: match.businessUnitId !== null ? String(match.businessUnitId) : undefined,
  };
}
