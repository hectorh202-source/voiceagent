# ServiceTitan integration

How this server talks to ServiceTitan's API: authentication, the three operations it actually performs, and the deliberate scope limits.

## Scope: leads, not live bookings

This integration **never writes directly to the ServiceTitan schedule**. When the AI agent wants to book an appointment, it creates a ServiceTitan **Lead** — a record ServiceTitan itself models as "an opportunity to book a job" — for a human staff member to review and actually schedule. This was a deliberate risk-reduction choice: the agent can be wrong, ServiceTitan's booking/capacity semantics are tenant-specific, and a bad automated write to a live schedule is a much worse failure mode than a lead sitting in a queue for a minute longer than ideal.

The one read-only operation (`checkAvailability`, see below) is safe to call freely since it never writes anything.

## Where the code lives

```
src/servicetitan/
  authClient.ts   # OAuth2 client-credentials token fetch + in-memory cache
  httpClient.ts   # shared request wrapper: injects auth headers, builds URLs
  customers.ts    # lookupCustomerByPhone(), createCustomer()
  leads.ts        # createLead()
  capacity.ts     # checkAvailability()
  types.ts        # shared response shapes (STCustomer, etc.)
```

Every function here that actually calls ServiceTitan starts by calling `requireServiceTitanConfig()`, which throws `ServiceTitanNotConfiguredError` if the tenant's credentials aren't fully set up yet (see below). The [tools layer](elevenlabs-tools.md) catches that specific error and turns it into a clean `503` response rather than a stack trace.

## Authentication

ServiceTitan uses OAuth2 **client-credentials** grant only (no user login flow) — [`authClient.ts`](../src/servicetitan/authClient.ts):

```
POST {authBaseUrl}/connect/token
  body: grant_type=client_credentials&client_id=...&client_secret=...
  → { access_token, expires_in }   (expires_in is ~900 seconds / 15 minutes)
```

The token is cached in memory (module-level variable, not persisted to disk — there's no need, it's cheap to refetch and short-lived anyway) and reused until 60 seconds before it would expire:

```ts
if (cached && cached.cacheKey === cacheKey && cached.expiresAt - 60_000 > now) {
  return cached.token;   // reuse
}
// otherwise, fetch a fresh one
```

The cache key includes the client ID and auth base URL, so if credentials are changed via `/settings` mid-run, the next request correctly fetches a new token instead of reusing one for the old credentials. ServiceTitan explicitly asks integrators to cache and reuse tokens rather than requesting one per API call — they rate-limit the token endpoint.

Every actual API request (not just the token fetch) needs **two** headers, added by [`httpClient.ts`](../src/servicetitan/httpClient.ts)'s `stRequest()`:
```
Authorization: Bearer <access_token>
ST-App-Key: <app key>
```
The app key is generated once per registered ServiceTitan developer app and works the same across both environments — only the tenant ID, base URLs, and client id/secret differ between sandbox and production.

## Environments

Two ServiceTitan environments are supported, chosen via the "Environment" dropdown in `/settings` (stored as `servicetitan.environment`, either `"integration"` or `"production"`):

| Environment | Auth base URL | API base URL |
|---|---|---|
| Integration / Sandbox | `https://auth-integration.servicetitan.io` | `https://api-integration.servicetitan.io` |
| Production | `https://auth.servicetitan.io` | `https://api.servicetitan.io` |

This project is currently configured against the **integration/sandbox** environment. Switching to production is just a dropdown change in `/settings` — no code change needed — but should only be done deliberately, since production leads are real customer-facing records.

## The three operations

### 1. Customer lookup — `lookupCustomerByPhone(phone)`

`GET /crm/v2/tenant/{tenantId}/customers`

ServiceTitan's phone-number filtering support isn't fully documented, so this function hedges:
1. First tries a direct query with a `phone` param.
2. If that returns nothing (or the param isn't actually supported by this tenant's API version), falls back to paging through recent customers (`pageSize: 50, sort: -createdOn`) and filtering client-side by matching normalized phone digits against each customer's `contacts` array.

Phone numbers are normalized to their last 10 digits before comparing (`normalizePhone()`), so formatting differences (`+1`, dashes, spaces) don't cause false negatives.

Returns `{ found, customerId, name, address }` — `found: false` with everything else `null` if no match.

### 2. Customer creation — `createCustomer(input)`

`POST /crm/v2/tenant/{tenantId}/customers`

Only called when `lookupCustomerByPhone` found no existing match (see `create_lead`'s flow below). Creates a `Residential`-type customer with an embedded address and a `Phone`-type contact. Returns the new customer ID and location ID (ServiceTitan creates a location alongside the customer; if the response doesn't include one for some reason, the code falls back to using the customer ID as the location ID rather than failing outright).

### 3. Lead creation — `createLead(input)`

`POST /crm/v2/tenant/{tenantId}/leads`

The core "book me" operation. Fields sent: `customerId`, `locationId`, and four **tenant-specific configuration IDs** pulled from `/settings` (`defaultBusinessUnitId`, `defaultCampaignId`, `defaultCallReasonId`, `defaultJobTypeId`) — these categorize the lead the same way a human CSR's ServiceTitan client would, and are configured once by whoever owns the ServiceTitan tenant (found in ServiceTitan's own admin UI under Settings). `priority` is set to `"Urgent"` if the agent flagged the call as an emergency, `"Normal"` otherwise. `summary` is built from the issue description and preferred timing the agent collected during the call.

This function never throws on a ServiceTitan-side failure — it catches, logs the error server-side, and returns `{ success: false, leadId: null }` so the calling tool handler can give the caller a graceful "a team member will follow up" response instead of a dead call.

### 4. Capacity check (read-only) — `checkAvailability(startDate, endDate)`

`GET /dispatch/v2/tenant/{tenantId}/capacity`

Used to give the caller a *rough* sense of availability ("we generally have room this week") without ever quoting or reserving a specific slot — consistent with the "leads, not bookings" scope limit above. Queries `startsOnOrAfter`/`endsOnOrBefore` plus the default business unit/job type, and reduces the response to a single boolean (`hasNearTermAvailability`) plus a canned sentence. If the call fails for any reason, it fails *open* with an optimistic default message rather than blocking the conversation — this is explicitly a "nice to have" signal, not something worth breaking a call over.

## Error handling philosophy

Two distinct failure modes are handled differently on purpose:

- **Not configured** (`ServiceTitanNotConfiguredError`, thrown by `requireServiceTitanConfig()`): this is a setup problem, not a ServiceTitan API problem. The tools layer returns `503` for this specifically, so it's distinguishable in logs/monitoring from an actual ServiceTitan outage or bad request.
- **ServiceTitan API failure** (anything else — bad credentials, ServiceTitan downtime, a malformed request): `createLead` and `checkAvailability` both catch and degrade gracefully (returning a "we'll follow up" or "we'll confirm" response) rather than letting an exception surface to the caller mid-conversation. `lookupCustomerByPhone`'s direct-query attempt also swallows failures (falling back to the paged search) since a lookup failing shouldn't block the rest of the call.

Every attempt — success or failure — is logged to the local `call_log` table by the [tools layer](elevenlabs-tools.md), so you can audit exactly what was sent to ServiceTitan and what came back.
