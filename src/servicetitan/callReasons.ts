import { requireServiceTitanConfig, stRequest } from "./httpClient";

// Confirmed against ServiceTitan's real OpenAPI spec (tenant-jbce-v2.json,
// "Job Booking" module) — NOT under crm/v2 despite living alongside
// callReasonId's use on /crm/v2/.../leads. Real path:
//   GET https://api.servicetitan.io/jbce/v2/tenant/{tenant}/call-reasons
// Response items: { id, name, isLead, active, createdOn, modifiedOn },
// paginated ({ page, pageSize, hasMore, totalCount, data }) same shape as
// most other ServiceTitan list endpoints.
interface STCallReason {
  id: number;
  name: string;
}

export async function findCallReasonIdByName(businessId: number, name: string): Promise<number | null> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/jbce/v2/tenant/${config.tenantId}/call-reasons`;

  try {
    const result = await stRequest<{ data: STCallReason[] }>(config, "GET", path, {
      params: { pageSize: 200 },
    });
    const normalized = name.trim().toLowerCase();
    const match = (result.data ?? []).find((reason) => reason.name.trim().toLowerCase() === normalized);
    return match ? match.id : null;
  } catch {
    return null;
  }
}
