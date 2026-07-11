import { requireServiceTitanConfig, stRequest } from "./httpClient";

interface STTagType {
  id: number;
  name: string;
}

export async function findTagTypeIdByName(name: string): Promise<number | null> {
  const config = requireServiceTitanConfig();
  const path = `/settings/v2/tenant/${config.tenantId}/tag-types`;

  try {
    const result = await stRequest<{ data: STTagType[] }>(config, "GET", path, {
      params: { pageSize: 200 },
    });
    const normalized = name.trim().toLowerCase();
    const match = (result.data ?? []).find((tag) => tag.name.trim().toLowerCase() === normalized);
    return match ? match.id : null;
  } catch {
    return null;
  }
}
