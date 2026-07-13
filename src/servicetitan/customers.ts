import { requireServiceTitanConfig, stRequest } from "./httpClient";
import type { STContact, STCustomer } from "./types";

export interface CustomerLookupResult {
  found: boolean;
  customerId: string | null;
  locationId: string | null;
  name: string | null;
  address: string | null;
  email: string | null;
  equipmentAge: string | null;
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
// name/address/etc. but no contacts at all), so email and phone can only be
// read via this separate per-customer sub-resource.
async function getCustomerContacts(businessId: number, customerId: string): Promise<STContact[]> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/crm/v2/tenant/${config.tenantId}/customers/${customerId}/contacts`;
  try {
    const result = await stRequest<{ data: STContact[] }>(config, "GET", path, {});
    return result.data ?? [];
  } catch {
    return [];
  }
}

async function getCustomerEmail(businessId: number, customerId: string): Promise<string | null> {
  const contacts = await getCustomerContacts(businessId, customerId);
  return contacts.find((contact) => contact.type === "Email")?.value ?? null;
}

interface STContactRecord extends STContact {
  customerId: number;
}

// GET .../customers/contacts (confirmed via ServiceTitan's CRM v2 OpenAPI spec)
// returns contacts across multiple customers in one call given a comma-separated
// `customerIds` list, unlike the plain customers list endpoint which never
// includes contacts. It has no phone filter of its own, so matching still
// happens client-side, but this replaces an N+1 per-customer loop with a
// single (occasionally paginated) request.
async function findPhoneMatchAmongCustomers(
  businessId: number,
  customerIds: number[],
  digits: string,
): Promise<number | null> {
  if (customerIds.length === 0) return null;
  const config = requireServiceTitanConfig(businessId);
  const path = `/crm/v2/tenant/${config.tenantId}/customers/contacts`;
  const idsParam = customerIds.join(",");

  let page = 1;
  for (;;) {
    let result: { data?: STContactRecord[]; hasMore?: boolean };
    try {
      result = await stRequest<{ data: STContactRecord[]; hasMore: boolean }>(config, "GET", path, {
        // ServiceTitan requires either modifiedBefore/modifiedOnOrAfter OR
        // customerIds, never both together — confirmed via a real 400:
        // "Cannot use other filters when 'customerIds' is in use". So
        // customerIds alone is both necessary and sufficient here.
        params: { customerIds: idsParam, pageSize: 200, page },
      });
    } catch {
      return null;
    }
    const match = (result.data ?? []).find(
      (contact) =>
        (contact.type === "Phone" || contact.type === "MobilePhone") && normalizePhone(contact.value) === digits,
    );
    if (match) return match.customerId;
    if (!result.hasMore) return null;
    page += 1;
  }
}

// Filters `?locationIds=` (plural — the only real location/customer-scoped
// filter this endpoint has; singular `locationId`/`customerId` are silently
// ignored by ServiceTitan and return the entire tenant's equipment list,
// which is what earlier diagnostics against those params actually hit).
// There's no direct "age" field, so it's derived from `installedOn`. When a
// location has multiple installed items (e.g. furnace + AC), the most
// recently modified active one is used — a heuristic, since there's no
// equipment-type filter to target a specific unit.
async function getInstalledEquipmentAge(
  businessId: number,
  customerId: string,
  locationId: string,
): Promise<string | null> {
  const config = requireServiceTitanConfig(businessId);
  const path = `/equipmentsystems/v2/tenant/${config.tenantId}/installed-equipment`;
  try {
    const result = await stRequest<{ data: { customerId: number; installedOn: string | null }[] }>(
      config,
      "GET",
      path,
      { params: { locationIds: locationId, active: "True", pageSize: 50, sort: "-modifiedOn" } },
    );
    const match = (result.data ?? []).find(
      (item) => String(item.customerId) === customerId && item.installedOn,
    );
    if (!match?.installedOn) return null;

    const years = Math.floor(
      (Date.now() - new Date(match.installedOn).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
    );
    return years < 1 ? "Less than 1 year" : `${years} year${years === 1 ? "" : "s"}`;
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
    const candidates = paged.data ?? [];
    const matchedId = await findPhoneMatchAmongCustomers(
      businessId,
      candidates.map((c) => c.id),
      digits,
    );
    if (matchedId !== null) {
      customers = candidates.filter((c) => c.id === matchedId);
    }
  }

  const match = customers[0];
  if (!match) {
    return {
      found: false,
      customerId: null,
      locationId: null,
      name: null,
      address: null,
      email: null,
      equipmentAge: null,
    };
  }

  const address = match.address
    ? [match.address.street, match.address.city, match.address.state].filter(Boolean).join(", ")
    : null;

  const customerId = String(match.id);
  // Equipment lookup needs locationId first, so this can't all run in one
  // Promise.all the way email/locationId used to.
  const locationId = await getPrimaryLocationId(businessId, customerId);
  const [email, equipmentAge] = await Promise.all([
    getCustomerEmail(businessId, customerId),
    locationId ? getInstalledEquipmentAge(businessId, customerId, locationId) : Promise.resolve(null),
  ]);

  return {
    found: true,
    customerId,
    locationId,
    name: match.name ?? null,
    address,
    email,
    equipmentAge,
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
