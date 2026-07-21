# ElevenLabs tools & agent configuration

This covers both halves of the ElevenLabs integration: the webhook endpoints this server exposes (code, in this repo), and the agent-side configuration in the ElevenLabs dashboard (not code — lives in ElevenLabs' own system, documented here so it isn't only recoverable by archaeology through chat history).

## How ElevenLabs calls into this server

ElevenLabs Conversational AI agents support "webhook tools" — during a live conversation, the agent's LLM can decide to call one of these, and ElevenLabs sends a POST request to the configured URL with a JSON body shaped by a schema you define per-tool in the dashboard. The response JSON is fed back to the LLM as the tool's result, and it continues the conversation.

Auth works via a **custom header**, not ElevenLabs signing the request: each tool is configured in the dashboard with a header (we use `X-Tool-Secret`) whose value is a stored "workspace secret." ElevenLabs attaches that header to every call to that tool. Our server just checks the header value matches what's saved for *that business* — see [`middleware/verifyToolSecret.ts`](../src/middleware/verifyToolSecret.ts):

```ts
const business = req.business;   // attached upstream by resolveBusiness, from the :businessId in the URL
if (!business) → 404
const secret = getBusinessSetting(business.id, "operational.toolWebhookSecret");
if (!secret) → 503 "Server is not configured yet"
const provided = req.header("X-Tool-Secret");
if (!provided) → 401 "Missing X-Tool-Secret header"
timing-safe compare provided vs. secret
if mismatch → 401 "Invalid tool secret"
otherwise → next() (request proceeds to the actual tool handler)
```

Each business has its own independent secret — business A's secret is rejected against business B's tool endpoints and vice versa, since the lookup is always scoped by the `business.id` that `resolveBusiness` (mounted ahead of everything under `/b/:businessId`) resolved from the URL.

This is deliberately decoupled from every other operational setting — it used to also require the emergency transfer number to be present (an unrelated field bundled into the same "operational config" getter), which caused real 401/503 confusion during setup. See [settings-app.md](settings-app.md#the-bug-this-design-fixes) and [sqlite-storage.md](sqlite-storage.md) for that history.

This middleware (`toolsRouter.use(verifyToolSecret)` in [`tools/router.ts`](../src/tools/router.ts)) runs in front of all four tool routes — no route-specific auth logic needed.

## The five tools (server side)

All five: validate the request body with `zod`, log the attempt to `call_log` (success or failure), and respond. The first four also do ServiceTitan work, where a `ServiceTitanNotConfiguredError` maps to `503` and any other ServiceTitan-side failure maps to `502`; `create_potential_lead` never touches ServiceTitan at all (see below).

### `lookup_customer` — [`tools/lookupCustomer.ts`](../src/tools/lookupCustomer.ts)

```
POST /b/:businessId/tools/lookup-customer
Request:  { "phone": string }
Response: { "found": boolean, "customerId": string|null, "name": string|null, "address": string|null,
            "email": string|null, "equipmentAge": string|null, "lastCallSummary": string|null }
```
Calls `servicetitan/customers.ts#lookupCustomerByPhone`. Meant to run **silently** at the start of a call (see agent config below) so the caller isn't asked to repeat a phone number ElevenLabs already has from caller ID.

**`lastCallSummary`** is [dynamic memory](dynamic-memory.md) — populated from `db/callMemory.ts#getCallMemory` only when that business has `operational.dynamicMemoryEnabled` turned on (off by default), `null` otherwise (opted out, or a first-time caller with no prior memory row). Read in its own try/catch, separate from the ServiceTitan lookup — a memory-read failure only means a missing summary, never a failed customer lookup. A business that enables this toggle needs one added prompt instruction: *"if `lastCallSummary` is non-empty, acknowledge what was discussed last time before continuing."* No other agent-side configuration is needed.

### `check_availability` — [`tools/checkAvailability.ts`](../src/tools/checkAvailability.ts)

```
POST /b/:businessId/tools/check-availability
Request:  { "startDate": string, "endDate": string, "serviceCategory"?: string }

Response (lead mode, default): { "hasNearTermAvailability": boolean, "note": string }
Response (job mode):           { "slots": { "start": string, "end": string, "label": string }[], "note": string }
```
Calls `servicetitan/capacity.ts#checkAvailability`, branching on that business's `servicetitan.bookingMode` setting. **Lead mode is deliberately coarse** — a signal for the agent to set expectations, never an exact bookable slot. **Job mode returns real bookable windows** (`label` is human-readable, e.g. `"Tuesday, July 15 at 2:00 PM"`, in the business's configured timezone) — the agent reads these aloud and lets the caller pick one, then passes the chosen `start`/`end` straight through to `book_job`.

**`serviceCategory` replaced an earlier `jobType` field that was accepted but never actually wired up to filter anything** — a real dead parameter, caught while building the category-resolution feature (see [servicetitan-integration.md](servicetitan-integration.md#6-dynamic-business-unitjob-type-via-service-categories)). It resolves to that business's configured business unit/job type for an accurate capacity check, instead of always using the single default.

### `book_job` — [`tools/bookJob.ts`](../src/tools/bookJob.ts)

```
POST /b/:businessId/tools/book-job
Request:  { "phone": string, "name": string, "street": string, "city": string, "state": string,
            "zip": string, "issueDescription": string, "preferredTiming"?: string,
            "equipmentAge"?: string, "isEmergency"?: boolean,
            "selectedStart"?: string, "selectedEnd"?: string, "serviceCategory"?: string }
Response: { "success": boolean, "jobId": string|null, "leadId": string|null, "confirmationMessage": string }
```
Only relevant for businesses with `servicetitan.bookingMode` set to `"job"` — see [servicetitan-integration.md](servicetitan-integration.md#5-job-booking-mode-createjobbusinessid-input) for the full backend design. Same customer-lookup/summary logic as `create_lead`, writing a ServiceTitan **Job** (with the caller's chosen appointment slot) instead of a Lead.

**`isEmergency` is a backend safety net, not just a routing hint** — if true, this handler skips booking entirely and creates a Lead instead (via the exact same logic `create_lead` uses), regardless of which tool the agent actually called. `selectedStart`/`selectedEnd` are optional at the schema level for exactly this reason — an emergency call may never have reached the point of offering a time slot.

### `create_lead` — [`tools/createLead.ts`](../src/tools/createLead.ts)

```
POST /b/:businessId/tools/create-lead
Request:  { "phone": string, "name": string, "street": string, "city": string, "state": string,
            "zip": string, "issueDescription": string, "preferredTiming"?: string,
            "equipmentAge"?: string, "isEmergency"?: boolean, "serviceCategory"?: string }
Response: { "success": boolean, "leadId": string|null, "confirmationMessage": string }
```
Looks up the customer again (reusing `lookupCustomerByPhone`); if not found, creates one; then creates the ServiceTitan Lead. Always returns a caller-appropriate `confirmationMessage`, even on failure, so the agent has something safe to say regardless of what happened underneath.

**`equipmentAge` is contextual, not something every call collects.** It's freeform text (`"3 years"`, `"about 3"`) rather than a bare number, matching how the agent will naturally phrase it back. This needs a corresponding ElevenLabs-side change — see "New tool parameters need a matching prompt instruction" below.

**Address is 4 separate fields (`street`/`city`/`state`/`zip`), not one combined string.** This wasn't the original design — it started as a single `address` field, but ServiceTitan's customer-creation API requires city/state/zip individually (confirmed via a real `422`-style validation error: `"Locations.Address.City": ["The City field is required."]`, etc.), and reliably splitting a freeform address string like `"4844 Maple Street, Port Charlotte, FL 33950"` back into parts server-side turned out to be unreliable — real test calls produced inconsistent formats (sometimes `"FL 33950"` as one segment, sometimes `"Florida"` and `"33844"` as two separate segments). Having the LLM extract each part directly, with its own Identifier/Description per field in the ElevenLabs tool config, is far more reliable than parsing a combined string after the fact.

### `create_potential_lead` — [`tools/createPotentialLead.ts`](../src/tools/createPotentialLead.ts)

```
POST /b/:businessId/tools/create-potential-lead
Request:  { "name"?: string, "phone"?: string, "email"?: string, "details"?: string,
            "reason"?: string, "conversationId"?: string }
Response: { "success": boolean, "confirmationMessage": string }
```
The catch-all: whenever a call can't produce a real ServiceTitan Lead/Job — missing required info, a ServiceTitan API error, the caller wasn't ready to commit, the issue is outside what this business handles, anything else — this captures whatever contact info the agent actually gathered instead of losing it outright. Unlike the other four tools, this **never touches ServiceTitan at all** — it writes straight into this app's own Leads inbox (`inbound_leads`, `source: "voice_agent"`) via `insertInboundLead()`, the same table website-form/chat/Google leads land in. At least one of `name`/`phone`/`email` is required (enforced by `catchAllLeadSchema`'s `.refine`); everything else is optional. `reason` is shown to staff alongside the lead (e.g. *"ServiceTitan lookup failed"*, *"caller wasn't ready to book"*, *"asked about a service we don't offer"*) so they know what to do with it, not just that it exists. If that business has turned on "Email me AI phone agent catch-all leads" (`/app/:businessId/settings/general` → Operational), this also fires an email alert — same fire-and-forget pattern as the chat widget's own lead notifications (`webhooks/leadIntake.ts`'s `notifyWidgetLead`), never blocking or failing the tool's response back to ElevenLabs.

## Agent-side configuration (ElevenLabs dashboard)

This part lives entirely in ElevenLabs' system — there's no code to read, so this section is the source of truth for how the agent is set up.

### Webhook tool definitions

Each of the five tools above is registered on the agent as a **Webhook** tool with:
- Method `POST`, URL pointing at this server's public domain + **that business's own `/b/:businessId/` path** + the tool path above (e.g. `https://voiceagent.laughslapper.com/b/1/tools/lookup-customer` for business #1). Every business's ElevenLabs agent must be configured with its own `businessId` baked into these URLs — copying another business's agent config verbatim and forgetting to update this segment is the most likely way to accidentally point one client's agent at another client's data.
- A header named `X-Tool-Secret`, whose value is a workspace **Secret** (created once in the ElevenLabs dashboard, value = that business's own tool webhook secret from its `/app/:businessId/settings/general` page) — not typed as a raw literal in the header field itself. **The header's Name field and the Secret's own label are two different things — don't confuse them.** Hit exactly this during setup: the header Name field ended up literally set to `New secret` (the dashboard's default label when you create a new secret), instead of `X-Tool-Secret` with the Secret dropdown separately pointing at that secret for its value. A header name containing a space isn't valid HTTP, so every call to that tool failed *before leaving ElevenLabs' servers* — nothing reached this app at all, which is why it showed zero trace in `call_log`/container logs despite genuinely being called. The tell-tale symptom was an error surfaced by ElevenLabs' own "test tool individually" button (see Debugging section below): `invalid header field name "New secret"`.
- A body parameter schema matching the request shape above. Each property's **Identifier** must be the exact bare field name (e.g. `phone`, not `{ "phone": string }` — the data type is already declared by a separate dropdown; the Identifier field is only the JSON key name)
- For `lookup_customer`'s `phone` parameter specifically: **Value Type** must be set to **"Dynamic Variable"** (not the default "LLM Prompt"), with the variable name entered as the bare identifier `system__caller_id` — **no `{{ }}` braces** in this field, since it's a dedicated variable picker, not free text. This matters: with "LLM Prompt" left selected, the model has to infer a phone number from the transcript, and since the caller never states their number out loud, the model has nothing to fill the field with and silently never calls the tool at all — this is exactly what happened during initial testing (`lookup_customer` never once appeared in `call_log` across several test calls, only `check_availability`/`create_lead` did, until this was fixed). The `{{system__caller_id}}` `{{ }}` syntax is only used when referencing a dynamic variable inside free text, e.g. inside the system prompt.
- **Data types matter for validation**: this server's body schemas are strict about JSON types (e.g. `isEmergency` must be a real boolean). ElevenLabs' tool-calling has been observed sending boolean-typed fields as the strings `"true"`/`"false"` rather than a JSON boolean — confirmed by a real `create_lead` call that 400'd with `"isEmergency":["Expected boolean, received string"]`. The server now coerces string `"true"`/`"false"` to boolean before validating (see `booleanish` in [`tools/createLead.ts`](../src/tools/createLead.ts)) rather than assuming the dashboard will always send the "correct" JSON type — a good pattern to repeat for any new boolean/number fields added later.

### New tool parameters need a matching prompt instruction

Adding a body field to `create_lead`'s schema (like `equipmentAge`) doesn't make the agent actually collect it — that's two separate changes, both required, both done in the ElevenLabs dashboard, not code:
1. Add the parameter to the `create_lead` tool's body schema (Identifier `equipmentAge`, **Value Type: LLM Prompt**, same as `issueDescription`/`preferredTiming` — not a Dynamic Variable, since nothing built-in carries this).
2. Add an instruction to the system prompt telling the agent *when* to ask for it — e.g. "if the call is about an HVAC/AC issue, ask how old the unit is." Without this, the field stays optional and the LLM has no reason to bring it up, so it'll simply be omitted from every lead's summary (see [servicetitan-integration.md](servicetitan-integration.md) for how the summary handles that gracefully) rather than erroring.

This is a good general pattern to remember for any future field: a schema change alone is inert without a corresponding prompt instruction telling the agent to actually populate it.

### Job-booking mode setup (only for businesses with `bookingMode = "job"`)

A business staying in the default lead mode needs **zero** ElevenLabs-side changes at all. Switching a business to job mode (`/app/:businessId/settings/general` → "What calls produce in ServiceTitan") requires setting up the following in that business's agent, in addition to everything already configured:

1. **Add `book_job` as a new webhook tool**, same auth/body pattern as `create_lead` above — method `POST`, URL `.../tools/book-job`, the same `X-Tool-Secret` header/Secret setup, and a body schema with all of `create_lead`'s parameters plus two more: `selectedStart` and `selectedEnd` (**Value Type: LLM Prompt** for both — the agent fills these in with whichever slot the caller picked from `check_availability`'s response, not a value ElevenLabs has any built-in variable for).
2. **A system-prompt instruction for the new flow**: after diagnosing a non-emergency issue, call `check_availability`, read the returned `slots[].label` values aloud, let the caller choose one, then call `book_job` with that slot's `start`/`end` as `selectedStart`/`selectedEnd`. For emergencies, keep calling `create_lead` exactly as today — the backend's own safety net (see [servicetitan-integration.md](servicetitan-integration.md#5-job-booking-mode-createjobbusinessid-input)) will route an emergency correctly even if the agent calls `book_job` by mistake, but the prompt should still say `create_lead` for emergencies as the primary instruction, not rely on that fallback.
3. Adjust the "always close by saying a team member will confirm the exact appointment" line from the base system prompt (below) — that's specifically lead-mode wording; a job-mode confirmation should instead confirm the actual booked time, since a real appointment now exists.

### Service categories setup (optional, any business)

Only relevant once you've configured 2+ rows under "Service categories" on `/app/:businessId/settings/business-info` — see [servicetitan-integration.md](servicetitan-integration.md#6-dynamic-business-unitjob-type-via-service-categories). If a business has no categories configured, `serviceCategory` is simply never sent and everything falls back to that business's single default business unit/job type exactly as before this feature existed — no ElevenLabs-side changes needed in that case.

If you do configure categories, add `serviceCategory` as a parameter on **`check_availability`, `create_lead`, and `book_job`** (whichever of the three that business's agent actually uses):
1. Identifier `serviceCategory`, **Value Type: LLM Prompt**.
2. Description: list the exact category names you configured for that business, e.g. *"One of: Plumbing, HVAC. Pick whichever trade best matches the issue described. Use the exact name shown — it must match one of these two options exactly."* The exact names matter — `resolveServiceCategory()` does a case-insensitive match, but a category name the agent invents that doesn't match any configured row silently falls back to the single default, no error surfaced.
3. A system-prompt instruction telling the agent to classify the issue into one of those categories once it knows the service type, before calling any of the three tools — e.g. "Once you know whether this is a plumbing or HVAC issue, include that in `serviceCategory` on every subsequent tool call for this conversation."

### Catch-all lead setup (optional, any business)

Registering `create_potential_lead` as a webhook tool (same auth/header pattern as the other four — method `POST`, URL `.../tools/create-potential-lead`, `X-Tool-Secret` header) isn't enough on its own — like `equipmentAge` above, a tool existing doesn't mean the agent knows *when* to reach for it. Add a system-prompt instruction along these lines:

*"If you cannot successfully create a lead or book a job for any reason — the caller can't provide required information, `create_lead`/`book_job` fails, the caller isn't ready to commit, or the request is for something this business doesn't handle — call `create_potential_lead` with whatever contact information (name, phone, or email) and details you were able to gather, plus a short `reason` explaining why. Never end the call without at least attempting this if a real lead/job wasn't created."*

This is deliberately the *last resort*, not a replacement for `create_lead`/`book_job` — the prompt should still try those first for anything that looks bookable, and only fall back to this when they genuinely don't apply or fail.

### Call Reason Data Collection setup (optional, any business)

Powers the "Call Reason" column on the Calls page of the React admin dashboard (`/app/:businessId/calls` — see [call-dashboard.md](call-dashboard.md#new-derived-data--call-duration-and-call-reason)) with a granular label like "Unbooked Price Concern" or "Excused Not Qualified Caller" — much more specific than the Booked/Not Booked/Excused status, which is derived purely from booking outcome and needs no ElevenLabs configuration at all. This column stays blank/dash for every call until you set this up.

Unlike the three webhook tools, this is **not a tool the agent calls mid-conversation** — it's ElevenLabs' post-call **Data Collection** feature: the agent's LLM re-reads the finished transcript after the call ends and classifies it into a field you define, delivered via the existing post-call webhook (`analysis.data_collection_results`) this app already receives — no new webhook endpoint, no new code path, just a new field arriving on the same payload `webhooks/postCall.ts` already parses.

Setup, in the agent's dashboard (not the same place as the three webhook tools):
1. Find the **Analysis** (or "Data Collection") tab on the agent's configuration — a separate section from Tools/Prompt/Workflow.
2. Add a new Data Collection field with **Identifier: `call_reason`** exactly — `postCall.ts`'s `extractCallReason()` looks up this exact key in `data_collection_results`; a different identifier means the value is silently never picked up (no error, the column just stays blank).
3. **Type: String**, with **Enum Values** filled in — this is what actually constrains the LLM to pick a single label from a fixed list rather than generating a freeform summary. Leaving Enum Values empty still works (the app stores whatever comes back verbatim either way), but produces an unconstrained one-line summary instead of a real category — fine as a first pass, but not the recommended setup below.
4. **Recommended: mirror the manual override dropdown exactly.** `client/src/pages/CallDetailPage.tsx`'s `CALL_REASON_GROUPS` already defines a curated 45-value taxonomy (Booked/Follow Up/Excused/Unbooked/Outbound, each broken into specific reasons) used for a human's manual override on the call detail page — paste those same 45 strings into Enum Values so an AI classification and a human override always speak the same vocabulary, and the column shows a real category either way rather than an arbitrary AI-written sentence. A `description` telling the LLM to pick the single best-matching enum value based on the call's actual outcome (and an `"Other"` catch-all for genuine misses) works well in practice — see the confirmed example below. This list is entirely up to you and isn't hardcoded anywhere in this app; expand/rename freely, just keep the client's dropdown and the enum in sync if you do.

**Confirmed against a real payload** (2026-07-15), enum-constrained: `analysis.data_collection_results.call_reason.value` came back as `"Unbooked - Pending Coordination"` — an exact match to one of the configured enum values, not a freeform sentence — and the stored `call_reason` column matched it byte-for-byte. (An earlier test before Enum Values was populated returned a freeform sentence like `"slow drip from sink"` instead — also stored correctly, just not constrained to the taxonomy.) Still worth a one-off spot-check (`docker compose exec app node`, piping in a small decrypt-and-print script — same pattern used elsewhere for direct-DB diagnostics) the first time *you* set this field up for a new business, since a materially different prompt/enum could in principle produce a different result.

### Emergency transfer

A built-in **system tool**, `transfer_to_number` (labeled "Transfer to number" in the dashboard, under Human Transfer Rules) — not a webhook tool, no code involved. Configured with:
- Transfer type: **Conference** (agent bridges the call to a human, can play a handoff message, then drops off — chosen over "Blind" for a smoother handoff)
- Destination: the emergency phone number, in E.164 format (e.g. `+19412259610`) — entered directly in the ElevenLabs dashboard, since ElevenLabs doesn't read our settings store. (An earlier version of `/settings` had a matching `operational.emergencyTransferNumber` field purely as a manual reference note, but it did nothing functionally and only risked implying the two were kept in sync — removed for that reason.)
- Condition (natural language, evaluated by ElevenLabs' own model): *"The caller describes an emergency — a gas smell, active flooding/water leak, no heat during freezing temperatures, or another situation posing immediate danger or property damage risk."*

This works because the number was imported via ElevenLabs' **native Twilio integration** (Phone Numbers tab → provide Twilio Account SID + Auth Token + the number) — that's what makes both Conference and Blind transfer types available; ElevenLabs configures the Twilio voice webhook automatically, no manual Twilio console changes needed.

### Ending the call

The system prompt (below) instructs the agent to call an `end_call` tool once the caller says goodbye. That's actually the built-in **"End conversation"** system tool, toggled in the same System tools panel as `transfer_to_number` — and it must be explicitly **enabled** there. Early testing hit exactly this: the prompt told the agent to always call `end_call`, but "End conversation" was toggled off, so the agent had no valid way to act on that instruction — the call just dropped abruptly with no spoken goodbye at all, instead of a clean acknowledge-then-hang-up. If a similar abrupt-ending symptom shows up again, check this toggle first before assuming it's a prompt-wording problem.

### System prompt

Structured in five sections (Personality / Environment / Tone / Goal / call-ending rules already existed from an earlier iteration of this agent; a **Tools & call flow** section was added to wire in the tools above):

- As the very first action on every call, before saying anything else, silently call `lookup_customer` using the caller's phone number — don't skip this step and don't mention it to the caller. Greet by name/address if found, otherwise ask naturally as part of qualifying. (This instruction needed to be this explicit/forceful — a softer "silently call this at call start" phrasing wasn't reliably followed.)
- Emergency check (matching the transfer rule's condition) → trigger the transfer tool immediately, skip everything else
- Otherwise: gather service type, issue, urgency, timing as normal; optionally call `check_availability` to set rough expectations
- Call `create_lead` once enough info is gathered
- Always close by saying a team member will confirm the exact appointment — **never** claim the job is booked/scheduled, since this integration only ever creates a Lead
- On a `create_lead` failure, apologize, confirm the phone number, promise a human follow-up — never let a tool failure dead-end the call
- If a real lead/job genuinely can't be created (see "Catch-all lead setup" above), call `create_potential_lead` with whatever was gathered instead of ending the call empty-handed

The exact current prompt text lives only in the ElevenLabs dashboard (agent → prompt editor) — if it drifts from this description, the dashboard is the source of truth, and this doc should be updated to match.

### Workflow (optional graph-based call structure)

This agent was set up from a template that includes an ElevenLabs **Workflow** — a node graph (Greeting → Assess Urgency → Emergency Dispatch / Schedule Standard → Wrap Up → End) that structures the call, separate from and layered on top of the plain system prompt. This is easy to miss entirely: the workflow controls the *entire* call from the first turn, not just some special end-of-call behavior, and its per-node prompts (`additional_prompt`) work alongside the base agent prompt above.

**The bare terminal node has no goodbye, by design of the template.** The graph's final edge went straight from `wrap_up` to a plain `end` node with no message at all — the instant the LLM judged "caller has no more questions," the call disconnected with zero opportunity to speak a farewell, regardless of anything in the system prompt's "When to end the call" section. This is a structural gap in the graph, not a prompt problem, and no amount of prompt tuning fixes it — confirmed by testing the `end_call` **tool** in isolation, which *does* work correctly (see below), while the graph's own termination path did not.

**There are two independent ways a call can end**, and they can race each other:
- **The graph's own edge logic** — reaching a terminal node ends the call directly, with no LLM/tool involved.
- **The LLM calling the built-in `end_call` tool itself**, per the base prompt's "When to end the call" instructions — this can happen from *any* node, mid-graph, and works correctly (confirmed via a transcript where the agent said a full, warm goodbye and hung up cleanly while still nominally in the `schedule_standard` node, having never reached `wrap_up`/`end` at all).

Which one "wins" depends on how the conversation flows — if it reaches the graph's terminal transition first, the abrupt version happens; if the LLM proactively invokes the tool first, it works fine. This inconsistency is why the abrupt cutoff felt intermittent rather than constant.

**The fix**: insert a dedicated node (e.g. "Farewell") between the last real node and the terminal `end` node, whose only job is to speak a goodbye, with the terminal transition happening only *after* it. In the dashboard's node-graph editor, clicking the "+" on an edge doesn't insert a node into that edge — it adds a **new parallel branch** from the same source node. To actually rewire things: configure the new node, set the *incoming* edge's condition to match the original, then delete the original direct edge, then add a new outgoing edge from the new node to `end`.

**That outgoing edge is the subtle part.** Edge "Transition type" options are `None`, `LLM Condition`, `Expression`:
- `None` isn't valid alone — the platform requires *some* condition on every edge (rejects with "At least one condition must be defined for the edge").
- `Expression` is a variable-comparison builder (`{variable} EQUALS {value}`), not a literal "always true" — not a good fit for "just proceed after this node speaks."
- The one that actually works: **`LLM Condition`, with different wording than the incoming edge.** Using the *same* condition text on both the incoming and outgoing edge of the new node causes the outgoing edge to evaluate true **immediately** — before the node ever gets a turn to generate its response — because the condition is judged against conversation state, which hasn't changed since entering the node. The graph cascades straight through with no speech at all (confirmed via a transcript showing "Transitioned to ... Farewell" immediately followed by "Agent ended the conversation," no goodbye in between). The fix is a condition that's structurally false until *after* the node has spoken, e.g. incoming edge: `"The caller has no more questions"`, outgoing edge: `"The agent has just delivered its goodbye message to the caller"` — the second only becomes true once that turn has actually happened.

**When recreating an agent from scratch** (e.g. after deleting one — this happened once already), don't assume a copy-pasted prompt or a template's defaults match what was there before. Pull the full agent config (see Debugging section below) and diff it against what's documented here — a recreated agent was missing the entire "Tools & call flow" prompt section, had a placeholder-strength emergency-transfer condition (`"emergency"` instead of the full sentence), had an undocumented/undescribed audio tag that wasn't there originally, and still had the graph's bare terminal node — none of that was obvious from the dashboard UI alone until the JSON was compared side by side.

## Debugging a live call

Since this server has no visibility into the call itself, the only way to see what happened is:
1. Whether/which `/tools/*` requests landed — check container logs: `docker compose logs app --tail 50` (each request is logged as `METHOD /tools/... -> STATUS (Nms)` by [`middleware/requestLogger.ts`](../src/middleware/requestLogger.ts))
2. The full request/response/success detail for each tool call — query the `call_log` table (see [sqlite-storage.md](sqlite-storage.md#inspecting-the-database-directly) for the inspection snippet)

If a test call ends without any `/tools/*` entries at all, there are two very different possible causes, and it's worth telling them apart before assuming it's a prompt/agent-behavior problem:
- **The agent never tried to call the tool** (expected in some cases — e.g. it transferred to the emergency line before needing any tool at all — not a bug)
- **The agent tried, but the request never reached this server** — e.g. a malformed header (see the header Name/Secret mixup above) causes ElevenLabs' own HTTP client to reject the request before it leaves their infrastructure. This looks identical to "never called" from our server's side (zero trace in logs either way), which made it genuinely hard to diagnose from `call_log` alone.

**ElevenLabs has a "test tool individually" button** on each webhook tool's config page — this was the key to actually finding the header bug above, since it surfaces the raw client-side error (`invalid header field name "New secret"`) that never shows up anywhere in this app's own logs. When a tool seems to silently never fire on real calls, test it standalone with that button first — it can immediately tell you whether the problem is on ElevenLabs' side (config/header/auth) before you go looking at this server's code or logs at all.

**Pulling the agent's full config as JSON** is the other big lever, especially when something changed and it's unclear what. It includes everything — the exact live prompt text, every tool's full schema, TTS/voice settings, guardrails, the workflow graph, the assigned phone number — in one place, which makes it possible to *diff* against a previous known-good state instead of clicking through the dashboard tab by tab. This is how the gaps in a recreated agent were actually found (see Workflow section above) — comparing the new export line-by-line against an earlier one immediately surfaced a missing prompt section and a couple of silently-reset settings that weren't obvious from the UI at all.
