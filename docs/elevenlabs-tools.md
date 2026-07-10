# ElevenLabs tools & agent configuration

This covers both halves of the ElevenLabs integration: the webhook endpoints this server exposes (code, in this repo), and the agent-side configuration in the ElevenLabs dashboard (not code — lives in ElevenLabs' own system, documented here so it isn't only recoverable by archaeology through chat history).

## How ElevenLabs calls into this server

ElevenLabs Conversational AI agents support "webhook tools" — during a live conversation, the agent's LLM can decide to call one of these, and ElevenLabs sends a POST request to the configured URL with a JSON body shaped by a schema you define per-tool in the dashboard. The response JSON is fed back to the LLM as the tool's result, and it continues the conversation.

Auth works via a **custom header**, not ElevenLabs signing the request: each tool is configured in the dashboard with a header (we use `X-Tool-Secret`) whose value is a stored "workspace secret." ElevenLabs attaches that header to every call to that tool. Our server just checks the header value matches what's saved in `/settings` — see [`middleware/verifyToolSecret.ts`](../src/middleware/verifyToolSecret.ts):

```ts
const secret = getSetting("operational.toolWebhookSecret");
if (!secret) → 503 "Server is not configured yet"
const provided = req.header("X-Tool-Secret");
if (!provided) → 401 "Missing X-Tool-Secret header"
timing-safe compare provided vs. secret
if mismatch → 401 "Invalid tool secret"
otherwise → next() (request proceeds to the actual tool handler)
```

This is deliberately decoupled from every other operational setting — it used to also require the emergency transfer number to be present (an unrelated field bundled into the same "operational config" getter), which caused real 401/503 confusion during setup. See [settings-app.md](settings-app.md#the-bug-this-design-fixes) and [sqlite-storage.md](sqlite-storage.md) for that history.

This middleware (`toolsRouter.use(verifyToolSecret)` in [`tools/router.ts`](../src/tools/router.ts)) runs in front of all three tool routes — no route-specific auth logic needed.

## The three tools (server side)

All three: validate the request body with `zod`, do the work, log the attempt to `call_log` (success or failure), and respond. A `ServiceTitanNotConfiguredError` maps to `503`; any other ServiceTitan-side failure maps to `502`.

### `lookup_customer` — [`tools/lookupCustomer.ts`](../src/tools/lookupCustomer.ts)

```
POST /tools/lookup-customer
Request:  { "phone": string }
Response: { "found": boolean, "customerId": string|null, "name": string|null, "address": string|null }
```
Calls `servicetitan/customers.ts#lookupCustomerByPhone`. Meant to run **silently** at the start of a call (see agent config below) so the caller isn't asked to repeat a phone number ElevenLabs already has from caller ID.

### `check_availability` — [`tools/checkAvailability.ts`](../src/tools/checkAvailability.ts)

```
POST /tools/check-availability
Request:  { "startDate": string, "endDate": string, "jobType"?: string }
Response: { "hasNearTermAvailability": boolean, "note": string }
```
Calls `servicetitan/capacity.ts#checkAvailability`. Deliberately coarse — a signal for the agent to set expectations, never an exact bookable slot.

### `create_lead` — [`tools/createLead.ts`](../src/tools/createLead.ts)

```
POST /tools/create-lead
Request:  { "phone": string, "name": string, "address": string, "issueDescription": string,
            "preferredTiming"?: string, "isEmergency"?: boolean }
Response: { "success": boolean, "leadId": string|null, "confirmationMessage": string }
```
Looks up the customer again (reusing `lookupCustomerByPhone`); if not found, creates one; then creates the ServiceTitan Lead. Always returns a caller-appropriate `confirmationMessage`, even on failure, so the agent has something safe to say regardless of what happened underneath.

## Agent-side configuration (ElevenLabs dashboard)

This part lives entirely in ElevenLabs' system — there's no code to read, so this section is the source of truth for how the agent is set up.

### Webhook tool definitions

Each of the three tools above is registered on the agent as a **Webhook** tool with:
- Method `POST`, URL pointing at this server's public domain + the path above (e.g. `https://voiceagent.laughslapper.com/tools/lookup-customer`)
- A header named `X-Tool-Secret`, whose value is a workspace **Secret** (created once in the ElevenLabs dashboard, value = the tool webhook secret from `/settings`) — not typed as a raw literal in the header field itself
- A body parameter schema matching the request shape above. Each property's **Identifier** must be the exact bare field name (e.g. `phone`, not `{ "phone": string }` — the data type is already declared by a separate dropdown; the Identifier field is only the JSON key name)
- For `lookup_customer`'s `phone` parameter specifically: bound to the built-in dynamic variable `{{system__caller_id}}` (ElevenLabs auto-populates this from the incoming call) rather than left as a pure "LLM Prompt" field, so it fires automatically without the agent needing to ask

### Emergency transfer

A built-in **system tool**, `transfer_to_number` (labeled "Transfer to number" in the dashboard, under Human Transfer Rules) — not a webhook tool, no code involved. Configured with:
- Transfer type: **Conference** (agent bridges the call to a human, can play a handoff message, then drops off — chosen over "Blind" for a smoother handoff)
- Destination: the emergency phone number, in E.164 format (e.g. `+19412259610`) — same number stored as `operational.emergencyTransferNumber` in `/settings`, but note this is a **separate, manual entry in the ElevenLabs dashboard** — changing the number in `/settings` does not automatically update this rule, since ElevenLabs doesn't read our settings store
- Condition (natural language, evaluated by ElevenLabs' own model): *"The caller describes an emergency — a gas smell, active flooding/water leak, no heat during freezing temperatures, or another situation posing immediate danger or property damage risk."*

This works because the number was imported via ElevenLabs' **native Twilio integration** (Phone Numbers tab → provide Twilio Account SID + Auth Token + the number) — that's what makes both Conference and Blind transfer types available; ElevenLabs configures the Twilio voice webhook automatically, no manual Twilio console changes needed.

### System prompt

Structured in five sections (Personality / Environment / Tone / Goal / call-ending rules already existed from an earlier iteration of this agent; a **Tools & call flow** section was added to wire in the tools above):

- Silently call `lookup_customer` at call start using caller ID; greet by name/address if found, otherwise ask naturally as part of qualifying
- Emergency check (matching the transfer rule's condition) → trigger the transfer tool immediately, skip everything else
- Otherwise: gather service type, issue, urgency, timing as normal; optionally call `check_availability` to set rough expectations
- Call `create_lead` once enough info is gathered
- Always close by saying a team member will confirm the exact appointment — **never** claim the job is booked/scheduled, since this integration only ever creates a Lead
- On a `create_lead` failure, apologize, confirm the phone number, promise a human follow-up — never let a tool failure dead-end the call

The exact current prompt text lives only in the ElevenLabs dashboard (agent → prompt editor) — if it drifts from this description, the dashboard is the source of truth, and this doc should be updated to match.

## Debugging a live call

Since this server has no visibility into the call itself, the only way to see what happened is:
1. Whether/which `/tools/*` requests landed — check container logs: `docker compose logs app --tail 50` (each request is logged as `METHOD /tools/... -> STATUS (Nms)` by [`middleware/requestLogger.ts`](../src/middleware/requestLogger.ts))
2. The full request/response/success detail for each tool call — query the `call_log` table (see [sqlite-storage.md](sqlite-storage.md#inspecting-the-database-directly) for the inspection snippet)

If a test call ends without any `/tools/*` entries at all, the most common reasons are: the agent transferred to the emergency line before needing any tool (expected behavior, not a bug), or the webhook tools/secret aren't fully configured yet in the dashboard.
