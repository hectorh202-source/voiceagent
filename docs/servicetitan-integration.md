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

Every function here takes a `businessId` as its first parameter and starts by calling `requireServiceTitanConfig(businessId)`, which throws `ServiceTitanNotConfiguredError` if *that business's* credentials aren't fully set up yet (see below). The [tools layer](elevenlabs-tools.md) catches that specific error and turns it into a clean `503` response rather than a stack trace. This is a multi-business platform — every function signature below should be read with an implicit "for this one business" on it; there is no shared/global ServiceTitan config anywhere.

## Authentication

ServiceTitan uses OAuth2 **client-credentials** grant only (no user login flow) — [`authClient.ts`](../src/servicetitan/authClient.ts):

```
POST {authBaseUrl}/connect/token
  body: grant_type=client_credentials&client_id=...&client_secret=...
  → { access_token, expires_in }   (expires_in is ~900 seconds / 15 minutes)
```

The token is cached in memory (a `Map<cacheKey, CachedToken>`, not persisted to disk — there's no need, it's cheap to refetch and short-lived anyway) and reused until 60 seconds before it would expire:

```ts
const existing = cache.get(cacheKey);
if (existing && existing.expiresAt - 60_000 > now) {
  return existing.token;   // reuse
}
// otherwise, fetch a fresh one
```

The cache key includes the client ID and auth base URL, so if credentials are changed via a business's settings mid-run, the next request correctly fetches a new token instead of reusing one for the old credentials. It's a `Map` rather than a single slot specifically because this is multi-business: each business has its own credentials/cache key, and two businesses' calls interleaving must not evict each other's cached token. ServiceTitan explicitly asks integrators to cache and reuse tokens rather than requesting one per API call — they rate-limit the token endpoint.

Every actual API request (not just the token fetch) needs **two** headers, added by [`httpClient.ts`](../src/servicetitan/httpClient.ts)'s `stRequest()`:
```
Authorization: Bearer <access_token>
ST-App-Key: <app key>
```
The app key is generated once per registered ServiceTitan developer app and works the same across both environments — only the tenant ID, base URLs, and client id/secret differ between sandbox and production.

## Environments

Two ServiceTitan environments are supported, chosen **independently per business** via the "Environment" dropdown on that business's `/b/:businessId/settings` page (stored as `servicetitan.environment` in `business_settings`, either `"integration"` or `"production"`):

| Environment | Auth base URL | API base URL |
|---|---|---|
| Integration / Sandbox | `https://auth-integration.servicetitan.io` | `https://api-integration.servicetitan.io` |
| Production | `https://auth.servicetitan.io` | `https://api.servicetitan.io` |

One business being on sandbox has no bearing on any other business's environment choice. Switching a business to production is just a dropdown change on its own settings page — no code change needed — but should only be done deliberately, since production leads are real customer-facing records.

## The three operations

### 1. Customer lookup — `lookupCustomerByPhone(businessId, phone)`

`GET /crm/v2/tenant/{tenantId}/customers`

ServiceTitan's phone-number filtering support isn't fully documented, so this function hedges:
1. First tries a direct query with a `phone` param.
2. If that returns nothing (or the param isn't actually supported by this tenant's API version), falls back to paging through recent customers (`pageSize: 50, sort: -createdOn`) and filtering client-side by matching normalized phone digits against each customer's `contacts` array.

Phone numbers are normalized to their last 10 digits before comparing (`normalizePhone()`), so formatting differences (`+1`, dashes, spaces) don't cause false negatives.

Returns `{ found, customerId, name, address, email }` — `found: false` with everything else `null` if no match. `email` comes from the customer's `Email`-type contact if ServiceTitan has one on file (same `contacts` array shape used for phone matching); `null` if not. `create_lead` (below) surfaces this as an `Email` line in the lead summary when present.

### 2. Customer creation — `createCustomer(businessId, input)`

`POST /crm/v2/tenant/{tenantId}/customers`

Only called when `lookupCustomerByPhone` found no existing match (see `create_lead`'s flow below). Creates a `Residential`-type customer with a `Phone`-type contact. Returns the new customer ID and location ID (ServiceTitan creates a location alongside the customer; if the response doesn't include one for some reason, the code falls back to using the customer ID as the location ID rather than failing outright).

**The request body must include a `locations` array, not just a top-level `address` field.** This wasn't obvious from the API surface alone — an earlier version of this code sent only a flat `address` object and got a `400` back: `"Required property 'locations' not found in JSON"`. ServiceTitan models a customer as having one or more physical locations, each with its own address, rather than one address living directly on the customer. The fix sends both: a top-level `address` (harmless/ignored-or-used depending on the tenant) and `locations: [{ name, address }]` with the real address data, since that's what the API actually validates against. City, State, and Zip are all required within that address — see [elevenlabs-tools.md](elevenlabs-tools.md) for why `create_lead`'s tool contract collects those as separate fields rather than one freeform address string.

### 3. Lead creation — `createLead(businessId, input)`

`POST /crm/v2/tenant/{tenantId}/leads`

The core "book me" operation. Fields sent: `customerId`, `locationId`, and four **tenant-specific configuration IDs** pulled from that business's own settings (`defaultBusinessUnitId`, `defaultCampaignId`, `defaultCallReasonId`, `defaultJobTypeId`) — these categorize the lead the same way a human CSR's ServiceTitan client would, and are configured once per business by whoever owns that business's ServiceTitan tenant (found in ServiceTitan's own admin UI under Settings). `priority` is set to `"Urgent"` if the agent flagged the call as an emergency, `"Normal"` otherwise.

**`summary` is a structured multi-line write-up, not one sentence** — built by `buildLeadSummary()` in [`tools/createLead.ts`](../src/tools/createLead.ts), since ServiceTitan carries a Lead's `summary` field over into the Job's Summary field once staff convert it, making this effectively the Job Summary too. It includes: the call date/time (in the business's configured dashboard timezone, `getAgentTimezone()`), a narrative line (issue + address + preferred timing + an emergency note if flagged), the caller's phone number (formatted via the shared `formatPhoneNumber()` in [`lib/format.ts`](../src/lib/format.ts)), the address again as its own labeled line, an **Email line** (only present when `lookupCustomerByPhone()` found an existing ServiceTitan customer with an `Email`-type contact on file — we never ask the caller for one during the call, so a brand-new customer's lead simply has no Email line), a **"Call Details" link** to this call's public `/b/:businessId/calls/:conversationId` page (see [call-dashboard.md](call-dashboard.md)), built via `getDashboardBaseUrl()` in `settings/store.ts` — defaults to this deployment's known dashboard domain (`https://dashboard.laughslapper.com`, the same one hardcoded in the `Caddyfile`) so the link works with zero setup; the `/settings` field `operational.dashboardBaseUrl` only exists to override it if the dashboard is ever hosted elsewhere. Rendered as an actual `<a href="...">` tag, not a bare URL — ServiceTitan's summary field doesn't auto-linkify plain text, so a bare URL just shows as inert text; confirmed this way it renders clickable. Omitted cleanly (not a broken link) only if the conversation ID itself is missing — and a closing `Call Taker: AI Agent` line. Only one phone number exists in this system (caller ID, bound to `system__caller_id`), so it's labeled plainly `Phone` rather than implying a separately-captured callback number that isn't actually collected today.

This function never throws on a ServiceTitan-side failure — it catches, logs the error server-side, and returns `{ success: false, leadId: null }` so the calling tool handler can give the caller a graceful "a team member will follow up" response instead of a dead call.

**Follow-up date fallback**: ServiceTitan requires either a `callReasonId` or a `followUpDate` on every lead — confirmed via a real `400`: `"Follow up date or Call Reason ID is required."` We don't have a real scheduled date from the call (`preferredTiming` is freeform text like "afternoons this week," not an actual date), so when `defaultCallReasonId` isn't configured in `/settings`, the code defaults `followUpDate` to one day out (`Date.now() + 24h`). This is a hardcoded value, not a `/settings` field — deliberately, since it's only satisfying a ServiceTitan API technicality (any value works; a human confirms the real appointment regardless) rather than a business decision that needs regular tuning, and it becomes moot entirely once a Call Reason ID is set. If it ever needs to change, it's a one-line edit at the top of the `followUpDate` calculation in [`servicetitan/leads.ts`](../src/servicetitan/leads.ts).

**Lead tagging — by name, not ID** — [`servicetitan/tags.ts`](../src/servicetitan/tags.ts): every lead can optionally be tagged (ServiceTitan's `tagTypeIds` array field) so staff can identify at a glance — and once it's converted, on the resulting job — that it came from this AI receptionist. Unlike the other four config IDs, this one is configured on that business's settings page **by tag name** (e.g. "AI Voice Agent"), not by numeric ID: ServiceTitan's own dashboard doesn't display tag-type IDs anywhere, even though they exist (confirmed via `GET /settings/v2/tenant/{tenantId}/tag-types`, which returns id+name pairs the UI never shows). `createLead()` looks up the configured name against that endpoint on every call and resolves it to an ID at request time — no caching, since lead creation is infrequent enough that an extra read call is cheap, and it means a renamed/newly-created tag in ServiceTitan is picked up immediately without redeploying anything. If the configured name doesn't match any existing tag (typo, or the tag was deleted), it logs a warning and the lead is still created without a tag, rather than failing the whole lead over a cosmetic categorization.

### 4. Capacity check (read-only) — `checkAvailability(businessId, startDate, endDate)`

`GET /dispatch/v2/tenant/{tenantId}/capacity`

Used to give the caller a *rough* sense of availability ("we generally have room this week") without ever quoting or reserving a specific slot — consistent with the "leads, not bookings" scope limit above. Queries `startsOnOrAfter`/`endsOnOrBefore` plus the default business unit/job type, and reduces the response to a single boolean (`hasNearTermAvailability`) plus a canned sentence. If the call fails for any reason, it fails *open* with an optimistic default message rather than blocking the conversation — this is explicitly a "nice to have" signal, not something worth breaking a call over.

## Error handling philosophy

Two distinct failure modes are handled differently on purpose:

- **Not configured** (`ServiceTitanNotConfiguredError`, thrown by `requireServiceTitanConfig()`): this is a setup problem, not a ServiceTitan API problem. The tools layer returns `503` for this specifically, so it's distinguishable in logs/monitoring from an actual ServiceTitan outage or bad request.
- **ServiceTitan API failure** (anything else — bad credentials, ServiceTitan downtime, a malformed request): `createLead` and `checkAvailability` both catch and degrade gracefully (returning a "we'll follow up" or "we'll confirm" response) rather than letting an exception surface to the caller mid-conversation. `lookupCustomerByPhone`'s direct-query attempt also swallows failures (falling back to the paged search) since a lookup failing shouldn't block the rest of the call.

Every attempt — success or failure — is logged to the local `call_log` table by the [tools layer](elevenlabs-tools.md), so you can audit exactly what was sent to ServiceTitan and what came back.
