import { requireServiceTitanConfig, stRequest } from "./httpClient";
import { getJobTypeAliases } from "../settings/store";

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
  // First associated business unit — used for createLead/createJob, which
  // each write to exactly one business unit, so a single value is required
  // there regardless of how many the job type actually lists.
  businessUnitId: number | null;
  // Every associated business unit, not just the first. Confirmed via real
  // production data (2026-08-08, TitanZ): a job type's real, working
  // technicians are not guaranteed to be on its first-listed business unit —
  // "Plumbing Install/ Repair" listed [386, 26465665], and every real
  // technician/open slot lived under 26465665 (the second one). Scoping the
  // capacity check to businessUnitId (first only) silently returned zero
  // availability from a job type that genuinely had real, bookable capacity.
  // checkAvailability() uses this full list; createLead/createJob still use
  // the single businessUnitId above.
  businessUnitIds: number[];
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
      businessUnitIds: match.businessUnitIds ?? [],
    };
  } catch {
    return null;
  }
}

// Fallback for when the agent's captured serviceCategory doesn't exactly
// match any real job type name — checked against this business's configured
// alias list (settings/store.ts's getJobTypeAliases) before giving up.
// Confirmed via real production logs (2026-08-07): the agent consistently
// sends generic category words ("Plumbing", "HVAC") rather than one of a
// business's actual, more specific job type names, so the exact match above
// alone was silently missing on every real call and falling back to the
// single configured default regardless of the real issue. Re-resolves via
// findJobTypeByName using the alias's target NAME (not a stored ID), so a
// renamed job type in ServiceTitan only needs the alias's target updated
// here, same "live, not stale" guarantee as the exact-match path.
async function findJobTypeByAlias(businessId: number, name: string): Promise<ResolvedJobType | null> {
  const aliases = getJobTypeAliases(businessId);
  if (aliases.length === 0) return null;
  const normalized = name.trim().toLowerCase();
  const aliasEntry = aliases.find((a) => a.alias.trim().toLowerCase() === normalized);
  if (!aliasEntry) return null;
  return findJobTypeByName(businessId, aliasEntry.jobTypeName);
}

// Thin convenience wrapper matching the {businessUnitId?, businessUnitIds?,
// jobTypeId?} string-typed shape createLead/createJob/checkAvailability
// expect — {} for "no override, use this business's configured default"
// whenever no service type was captured on the call or nothing in
// ServiceTitan matches it by name (directly or via an alias).
// businessUnitId (singular, first) is for createLead/createJob, which each
// write to exactly one business unit. businessUnitIds (plural, all) is for
// checkAvailability, which should check every business unit a job type is
// actually associated with — see ResolvedJobType's comment for why using
// only the first silently hid real, bookable capacity.
export async function resolveJobTypeOverrides(
  businessId: number,
  serviceType: string | undefined,
): Promise<{ businessUnitId?: string; businessUnitIds?: string[]; jobTypeId?: string }> {
  if (!serviceType) return {};
  const match = (await findJobTypeByName(businessId, serviceType)) ?? (await findJobTypeByAlias(businessId, serviceType));
  if (!match) return {};
  return {
    jobTypeId: String(match.jobTypeId),
    businessUnitId: match.businessUnitId !== null ? String(match.businessUnitId) : undefined,
    businessUnitIds: match.businessUnitIds.length ? match.businessUnitIds.map(String) : undefined,
  };
}
