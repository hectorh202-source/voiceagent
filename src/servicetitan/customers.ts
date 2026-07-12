import { requireServiceTitanConfig, stRequest } from "./httpClient";
import type { STCustomer } from "./types";

export interface CustomerLookupResult {
  found: boolean;
  customerId: string | null;
  locationId: string | null;
  name: string | null;
  address: string | null;
  email: string | null;
}

async function getPrimaryLocationId(businessId: number, customerId: string): Promise<string | null> {
  const config = requireServiceTitanConfig(businessId);
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

// The customer list/search endpoint never includes a `contacts` field on its
// results (confirmed against a real sandbox customer — its response has
// name/address/etc. but no contacts at all), so email (and phone, for that
// matter) can only be read via this separate per-customer sub-resource.
async function getCustomerEmail(businessId: number, customerId: string): Promise<string | null> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/crm/v2/tenant/${config.tenantId}/customers/${customerId}/contacts`;
  try {
    const result = await stRequest<{ data: { type: string; value: string }[] }>(config, "GET", path, {});
    return result.data?.find((contact) => contact.type === "Email")?.value ?? null;
  } catch {
    return null;
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "").slice(-10);
}

export async function lookupCustomerByPhone(businessId: number, phone: string): Promise<CustomerLookupResult> {
  const config = requireServiceTitanConfig(businessId);
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
    return { found: false, customerId: null, locationId: null, name: null, address: null, email: null };
  }

  const address = match.address
    ? [match.address.street, match.address.city, match.address.state].filter(Boolean).join(", ")
    : null;

  const customerId = String(match.id);
  const [locationId, email] = await Promise.all([
    getPrimaryLocationId(businessId, customerId),
    getCustomerEmail(businessId, customerId),
  ]);

  return {
    found: true,
    customerId,
    locationId,
    name: match.name ?? null,
    address,
    email,
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

export async function createCustomer(businessId: number, input: CreateCustomerInput): Promise<CreateCustomerResult> {
  const config = requireServiceTitanConfig(businessId);
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
