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
  leads.ts        # createLead(), updateLeadSummary()
  leadSummary.ts  # buildLeadSummary(), buildInitialNarrative() — shared by tools/createLead.ts and webhooks/postCall.ts
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

This function hedges:
1. First tries a direct query with a `phone` param — confirmed against the real OpenAPI spec as a real, documented filter, so this is the common-case path.
2. If that returns nothing, falls back to paging through recent customers (`pageSize: 50, sort: -createdOn`) and resolving the phone match via the bulk `GET /crm/v2/tenant/{tenantId}/customers/contacts?customerIds=...` endpoint (`findPhoneMatchAmongCustomers()`) — one request (paginated if needed) covering all the candidate customer IDs at once, rather than looping per customer. Matches against both `Phone` and `MobilePhone` contact types.

**This bulk contacts endpoint has its own filter-conflict quirk, confirmed via a real `400` during live testing**: `customerIds` and the `modifiedBefore`/`modifiedOnOrAfter` date filters are mutually exclusive — `"Cannot use other filters when 'customerIds' is in use"`. An early version of `findPhoneMatchAmongCustomers()` sent both (reading the endpoint's "either modifiedBefore or modifiedOnOrAfter must be specified" prose as an unconditional requirement), which 400'd on every real call. Fixed by sending `customerIds` alone — it's both necessary and sufficient on its own.

An earlier version of the fallback filtered client-side against each customer's own `contacts` field from the plain customer-list response — but that field is never actually populated by the list endpoint (see the Email note just below), so the fallback was silently dead code that could never match anything. This was caught and fixed by switching to the bulk contacts endpoint above.

Phone numbers are normalized to their last 10 digits before comparing (`normalizePhone()`), so formatting differences (`+1`, dashes, spaces) don't cause false negatives.

Returns `{ found, customerId, name, address, email, equipmentAge }` — `found: false` with everything else `null` if no match.

**Email requires a second API call — the customer list endpoint doesn't return contacts at all.** Confirmed against a real sandbox customer: the `GET /customers` response above has `name`/`address`/etc. but no `contacts` field whatsoever, even though phone-number filtering against this same endpoint works (ServiceTitan does that matching server-side via the `phone` query param, without needing to expose the underlying contact record back to the caller). Email (and any other contact info) only comes from the separate `GET /crm/v2/tenant/{tenantId}/customers/{customerId}/contacts` sub-resource — `getCustomerEmail()` calls this once the customer's ID is known and finds the entry with `type === "Email"`. `create_lead` (below) surfaces this as an `Email` line in the lead summary when present.

### 2. Customer creation — `createCustomer(businessId, input)`

`POST /crm/v2/tenant/{tenantId}/customers`

Only called when `lookupCustomerByPhone` found no existing match (see `create_lead`'s flow below). Creates a `Residential`-type customer with a `Phone`-type contact. Returns the new customer ID and location ID (ServiceTitan creates a location alongside the customer; if the response doesn't include one for some reason, the code falls back to using the customer ID as the location ID rather than failing outright).

**The request body must include a `locations` array, not just a top-level `address` field.** This wasn't obvious from the API surface alone — an earlier version of this code sent only a flat `address` object and got a `400` back: `"Required property 'locations' not found in JSON"`. ServiceTitan models a customer as having one or more physical locations, each with its own address, rather than one address living directly on the customer. The fix sends both: a top-level `address` (harmless/ignored-or-used depending on the tenant) and `locations: [{ name, address }]` with the real address data, since that's what the API actually validates against. City, State, and Zip are all required within that address — see [elevenlabs-tools.md](elevenlabs-tools.md) for why `create_lead`'s tool contract collects those as separate fields rather than one freeform address string.

### 3. Lead creation — `createLead(businessId, input)`

`POST /crm/v2/tenant/{tenantId}/leads`

The core "book me" operation. Fields sent: `customerId`, `locationId`, and four **tenant-specific configuration IDs** pulled from that business's own settings (`defaultBusinessUnitId`, `defaultCampaignId`, `defaultCallReasonId`, `defaultJobTypeId`) — these categorize the lead the same way a human CSR's ServiceTitan client would, and are configured once per business by whoever owns that business's ServiceTitan tenant (found in ServiceTitan's own admin UI under Settings). `priority` is set to `"Urgent"` if the agent flagged the call as an emergency, `"Normal"` otherwise.

**`campaignId` is required by ServiceTitan on every lead** — confirmed against the real OpenAPI spec (`POST /leads`'s request schema lists `campaignId` and `summary` as the only two required fields). `createLead()` checks `defaultCampaignId` up front and fails fast with a clear server log (rather than sending `undefined` and letting ServiceTitan reject it with an opaque `400`) if a business hasn't configured one — the settings page labels this field "required for lead creation" for the same reason.

**`summary` is a structured multi-line write-up, not one sentence** — built by `buildLeadSummary()` in [`servicetitan/leadSummary.ts`](../src/servicetitan/leadSummary.ts) (shared between `tools/createLead.ts` and `webhooks/postCall.ts` — see below), since ServiceTitan carries a Lead's `summary` field over into the Job's Summary field once staff convert it, making this effectively the Job Summary too. It includes: the call date/time (in the business's configured dashboard timezone, `getAgentTimezone()`), a **narrative line** (see the two-phase lifecycle below), the caller's phone number (formatted via the shared `formatPhoneNumber()` in [`lib/format.ts`](../src/lib/format.ts)), the address again as its own labeled line, an **Email line** (only present when `lookupCustomerByPhone()` found an existing ServiceTitan customer with an `Email`-type contact on file — we never ask the caller for one during the call, so a brand-new customer's lead simply has no Email line), an **Age of Equipment line** (a bare number like `6`, from a new optional `equipmentAge` field on `create_lead` — the agent asks this contextually on HVAC/AC-related calls, per a system-prompt instruction configured in ElevenLabs, not something every call collects), a **"Call Details" link** to this call's public `/b/:businessId/calls/:conversationId` page (see [call-dashboard.md](call-dashboard.md)), built via `getDashboardBaseUrl()` in `settings/store.ts` — defaults to this deployment's known dashboard domain (`https://dashboard.laughslapper.com`, the same one hardcoded in the `Caddyfile`) so the link works with zero setup; the `/settings` field `operational.dashboardBaseUrl` only exists to override it if the dashboard is ever hosted elsewhere. Rendered as an actual `<a href="...">` tag, not a bare URL — ServiceTitan's summary field doesn't auto-linkify plain text, so a bare URL just shows as inert text; confirmed this way it renders clickable. Omitted cleanly (not a broken link) only if the conversation ID itself is missing — and a closing `Call Taker: AI Agent` line. Only one phone number exists in this system (caller ID, bound to `system__caller_id`), so it's labeled plainly `Phone` rather than implying a separately-captured callback number that isn't actually collected today.

**The narrative line has two phases, because the real AI call summary doesn't exist yet when the Lead is created.** `create_lead` runs mid-call, before ElevenLabs has generated anything — so at creation time, `tools/createLead.ts` builds a short placeholder narrative itself via `buildInitialNarrative()` (issue + address + preferred timing + an emergency note, same wording as before this two-phase design existed). Once the call ends and ElevenLabs' post-call webhook delivers the real `analysis.transcript_summary` (see [call-dashboard.md](call-dashboard.md)), `webhooks/postCall.ts` looks up the `call_log` row that `create_lead` wrote for this `conversation_id` (`findCreateLeadLogByConversationId()` — the same correlation technique the call-detail dashboard already uses), pulls the original address/phone/email plus the `leadId` back out of it, rebuilds the summary with `buildLeadSummary()` using the real AI summary as the narrative instead, and calls the new `updateLeadSummary(businessId, leadId, summary)` in `servicetitan/leads.ts` — **`PATCH /crm/v2/tenant/{tenantId}/leads/{id}`, the only place this app ever writes to a Lead after creating it.** Confirmed correct against the real OpenAPI spec (`PATCH` accepting a partial `{ summary }` body). A failure here is logged and swallowed; it never affects the webhook's `200` response to ElevenLabs, since the transcript/summary itself was already received and stored successfully regardless of whether this follow-up ServiceTitan write works. If `create_lead` never ran for a call (no lead, or it failed), there's nothing to update and this step is silently skipped.

`email` and `equipmentAge` both need to survive from creation-time to update-time too — `email` isn't part of `create_lead`'s own request body (it comes from a separate ServiceTitan lookup), and `equipmentAge` is the already-*resolved* value (the agent's fresh answer or the ServiceTitan on-file fallback, whichever won per the precedence rule above), not just whatever raw value happened to be in the request. So `handleCreateLead()` includes both in the object passed to `logToolCall()`'s `response` field alongside `leadId`, purely so the webhook can read them back later — neither is ever sent back to ElevenLabs itself.

**Bug, found and fixed via a live test**: `equipmentAge` was originally omitted from that carried-along response object entirely. Since the post-call rebuild *always* runs shortly after every call that created a lead, the Age of Equipment line would show up briefly at creation time and then silently disappear the moment the real-summary rebuild fired — which is effectively every real call, making the feature look completely broken in practice despite working correctly at creation. Fixed by carrying `equipmentAge` through the same way `email` already was.

This function never throws on a ServiceTitan-side failure — it catches, logs the error server-side, and returns `{ success: false, leadId: null }` so the calling tool handler can give the caller a graceful "a team member will follow up" response instead of a dead call.

**Follow-up date fallback**: ServiceTitan requires either a `callReasonId` or a `followUpDate` on every lead — confirmed via a real `400`: `"Follow up date or Call Reason ID is required."` We don't have a real scheduled date from the call (`preferredTiming` is freeform text like "afternoons this week," not an actual date), so when `defaultCallReasonId` isn't configured in `/settings`, the code defaults `followUpDate` to one day out (`Date.now() + 24h`). This is a hardcoded value, not a `/settings` field — deliberately, since it's only satisfying a ServiceTitan API technicality (any value works; a human confirms the real appointment regardless) rather than a business decision that needs regular tuning, and it becomes moot entirely once a Call Reason ID is set. If it ever needs to change, it's a one-line edit at the top of the `followUpDate` calculation in [`servicetitan/leads.ts`](../src/servicetitan/leads.ts).

**Lead tagging — by name, not ID** — [`servicetitan/tags.ts`](../src/servicetitan/tags.ts): every lead can optionally be tagged (ServiceTitan's `tagTypeIds` array field) so staff can identify at a glance — and once it's converted, on the resulting job — that it came from this AI receptionist. Unlike the other four config IDs, this one is configured on that business's settings page **by tag name** (e.g. "AI Voice Agent"), not by numeric ID: ServiceTitan's own dashboard doesn't display tag-type IDs anywhere, even though they exist (confirmed via `GET /settings/v2/tenant/{tenantId}/tag-types`, which returns id+name pairs the UI never shows). `createLead()` looks up the configured name against that endpoint on every call and resolves it to an ID at request time — no caching, since lead creation is infrequent enough that an extra read call is cheap, and it means a renamed/newly-created tag in ServiceTitan is picked up immediately without redeploying anything. If the configured name doesn't match any existing tag (typo, or the tag was deleted), it logs a warning and the lead is still created without a tag, rather than failing the whole lead over a cosmetic categorization.

**Pulling equipment age from ServiceTitan for returning customers** — `getInstalledEquipmentAge()` in [`servicetitan/customers.ts`](../src/servicetitan/customers.ts). An earlier round of sandbox testing concluded this endpoint couldn't be scoped to a customer or location at all (`?customerId=`/`?locationId=` were both silently ignored, returning the same unfiltered tenant-wide list; nested `/customers/{id}/installed-equipment` and `/locations/{id}/installed-equipment` both `404`'d) — that conclusion turned out to be wrong, just based on incomplete guessing rather than the real API surface. Checking the actual OpenAPI spec (`GET /equipmentsystems/v2/tenant/{tenantId}/installed-equipment` — no hyphen in `equipmentsystems`, unlike the spec filename; an early version of this code used the hyphenated form and got a `404` until caught via live testing) showed the real filter is `locationIds` (**plural**, comma-separated) — `customerId` and singular `locationId` were never real query params, which is exactly why ServiceTitan ignored them instead of erroring.

`getInstalledEquipmentAge(businessId, customerId, locationId)` calls this with `locationIds={locationId}` and `active: "True"`, then does a client-side `customerId` match as a safety check against the response (each item includes its own `customerId`) since the filter itself is location-scoped, not customer-scoped. There's no direct "age" field — it's derived from `installedOn` (rounded down to whole years, or `"Less than 1 year"` under a year). When a location has multiple installed items (furnace + AC, etc.), the most recently modified active one wins — a heuristic, since there's no equipment-type filter to target a specific unit. Wired into `lookupCustomerByPhone()` alongside the existing email lookup, `CustomerLookupResult` gains `equipmentAge: string | null`. Same defensive pattern as `getCustomerEmail()` — any failure (not configured, no equipment tracked, wrong tenant setup) returns `null` rather than ever breaking lead creation over this field.

**Live-verified end-to-end** against a real sandbox customer with equipment on file: `locationIds` correctly scoped the result to that one location, the `customerId` safety check matched, and the age math produced the correct value against a real `installedOn` date. The full `lookupCustomerByPhone()` path (phone → customer → location → email + equipment age, all in parallel) was confirmed working together, not just the isolated function.

**Displayed as a bare number, not a phrase** — `normalizeEquipmentAge()` in `leadSummary.ts` strips both sources down to just the digit before the line is built: the agent's own freeform capture (e.g. "six years old" from a real test call) and ServiceTitan's own `"5 years"`/`"Less than 1 year"` phrasing both land inconsistently worded otherwise. It matches a leading digit first (covers the ServiceTitan-sourced case), then falls back to parsing common number words (one through fifty, including compounds like "twenty five") for the agent's spoken-language capture. Anything it can't parse a leading number out of (an odd freeform answer, or the intentional "Less than 1 year" case) is left as-is rather than guessing.

**Precedence**: `tools/createLead.ts` uses the agent's fresh answer from *this* call if given (equipment gets replaced, so a fresh answer is more likely current), falling back to this ServiceTitan-sourced value only when the agent didn't ask/get one this call (e.g. a non-HVAC issue, or the agent skipped the question).

### 4. Capacity check (read-only) — `checkAvailability(businessId, startDate, endDate)`

`POST /dispatch/v2/tenant/{tenantId}/capacity`

Used to give the caller a *rough* sense of availability ("we generally have room this week") without ever quoting or reserving a specific slot — consistent with the "leads, not bookings" scope limit above. Sends `startsOnOrAfter`/`endsOnOrBefore` plus the default business unit/job type **as a JSON body**, and reduces the response to a single boolean (`hasNearTermAvailability`) plus a canned sentence. If the call fails for any reason, it fails *open* with an optimistic default message rather than blocking the conversation — this is explicitly a "nice to have" signal, not something worth breaking a call over.

**Corrected against the real OpenAPI spec** — this previously sent a `GET` with query params, which doesn't match the real endpoint at all (it's `POST`-only, with a required `skillBasedAvailability` boolean the old code never sent). That mismatch had likely been silently failing on every real call since this was built, always falling through to the optimistic fallback — which is exactly why it went uncaught for so long. `skillBasedAvailability` is hardcoded to `false` (no skill-based scheduling in use today); the rest of the request/response shape was unaffected.

## Error handling philosophy

Two distinct failure modes are handled differently on purpose:

- **Not configured** (`ServiceTitanNotConfiguredError`, thrown by `requireServiceTitanConfig()`): this is a setup problem, not a ServiceTitan API problem. The tools layer returns `503` for this specifically, so it's distinguishable in logs/monitoring from an actual ServiceTitan outage or bad request.
- **ServiceTitan API failure** (anything else — bad credentials, ServiceTitan downtime, a malformed request): `createLead` and `checkAvailability` both catch and degrade gracefully (returning a "we'll follow up" or "we'll confirm" response) rather than letting an exception surface to the caller mid-conversation. `lookupCustomerByPhone`'s direct-query attempt also swallows failures (falling back to the paged search) since a lookup failing shouldn't block the rest of the call.

Every attempt — success or failure — is logged to the local `call_log` table by the [tools layer](elevenlabs-tools.md), so you can audit exactly what was sent to ServiceTitan and what came back.
