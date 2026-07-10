import { requireServiceTitanConfig, stRequest } from "./httpClient";
import type { STCustomer } from "./types";

export interface CustomerLookupResult {
  found: boolean;
  customerId: string | null;
  locationId: string | null;
  name: string | null;
  address: string | null;
}

async function getPrimaryLocationId(customerId: string): Promise<string | null> {
  const config = requireServiceTitanConfig();
  const path = `/crm/v2/tenant/${config.tenantId}/locations`;
  try {
    const result = await stRequest<{ data: { id: number }[] }>(config, "GET", path, {
      params: { customerId, pageSize: 1 },
    });
    const location = result.data?.[0];
    return location ? String(location.id) : null;
  } catch {
    return null;
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "").slice(-10);
}

export async function lookupCustomerByPhone(phone: string): Promise<CustomerLookupResult> {
  const config = requireServiceTitanConfig();
  const digits = normalizePhone(phone);
  const path = `/crm/v2/tenant/${config.tenantId}/customers`;

  let customers: STCustomer[] = [];
  try {
    const direct = await stRequest<{ data: STCustomer[] }>(config, "GET", path, {
      params: { phone: digits, pageSize: 5 },
    });
    customers = direct.data ?? [];
  } catch {
    customers = [];
  }

  if (customers.length === 0) {
    const paged = await stRequest<{ data: STCustomer[] }>(config, "GET", path, {
      params: { pageSize: 50, sort: "-createdOn" },
    });
    customers = (paged.data ?? []).filter((c) =>
      (c.contacts ?? []).some(
        (contact) => contact.type === "Phone" && normalizePhone(contact.value) === digits,
      ),
    );
  }

  const match = customers[0];
  if (!match) {
    return { found: false, customerId: null, locationId: null, name: null, address: null };
  }

  const address = match.address
    ? [match.address.street, match.address.city, match.address.state].filter(Boolean).join(", ")
    : null;

  const customerId = String(match.id);
  const locationId = await getPrimaryLocationId(customerId);

  return {
    found: true,
    customerId,
    locationId,
    name: match.name ?? null,
    address,
  };
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  address: { street: string; city?: string; state?: string; zip?: string };
}

export interface CreateCustomerResult {
  customerId: string;
  locationId: string;
}

export async function createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
  const config = requireServiceTitanConfig();
  const path = `/crm/v2/tenant/${config.tenantId}/customers`;

  const address = {
    street: input.address.street,
    city: input.address.city ?? "",
    state: input.address.state ?? "",
    zip: input.address.zip ?? "",
    country: "USA",
  };

  const response = await stRequest<{ id: number; locations?: { id: number }[] }>(config, "POST", path, {
    data: {
      name: input.name,
      type: "Residential",
      address,
      contacts: [{ type: "Phone", value: input.phone }],
      locations: [{ name: input.name, address }],
    },
  });

  const locationId = response.locations?.[0]?.id;
  return {
    customerId: String(response.id),
    locationId: locationId ? String(locationId) : String(response.id),
  };
}
