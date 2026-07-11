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
Request:  { "phone": string, "name": string, "street": string, "city": string, "state": string,
            "zip": string, "issueDescription": string, "preferredTiming"?: string, "isEmergency"?: boolean }
Response: { "success": boolean, "leadId": string|null, "confirmationMessage": string }
```
Looks up the customer again (reusing `lookupCustomerByPhone`); if not found, creates one; then creates the ServiceTitan Lead. Always returns a caller-appropriate `confirmationMessage`, even on failure, so the agent has something safe to say regardless of what happened underneath.

**Address is 4 separate fields (`street`/`city`/`state`/`zip`), not one combined string.** This wasn't the original design — it started as a single `address` field, but ServiceTitan's customer-creation API requires city/state/zip individually (confirmed via a real `422`-style validation error: `"Locations.Address.City": ["The City field is required."]`, etc.), and reliably splitting a freeform address string like `"4844 Maple Street, Port Charlotte, FL 33950"` back into parts server-side turned out to be unreliable — real test calls produced inconsistent formats (sometimes `"FL 33950"` as one segment, sometimes `"Florida"` and `"33844"` as two separate segments). Having the LLM extract each part directly, with its own Identifier/Description per field in the ElevenLabs tool config, is far more reliable than parsing a combined string after the fact.

## Agent-side configuration (ElevenLabs dashboard)

This part lives entirely in ElevenLabs' system — there's no code to read, so this section is the source of truth for how the agent is set up.

### Webhook tool definitions

Each of the three tools above is registered on the agent as a **Webhook** tool with:
- Method `POST`, URL pointing at this server's public domain + the path above (e.g. `https://voiceagent.laughslapper.com/tools/lookup-customer`)
- A header named `X-Tool-Secret`, whose value is a workspace **Secret** (created once in the ElevenLabs dashboard, value = the tool webhook secret from `/settings`) — not typed as a raw literal in the header field itself. **The header's Name field and the Secret's own label are two different things — don't confuse them.** Hit exactly this during setup: the header Name field ended up literally set to `New secret` (the dashboard's default label when you create a new secret), instead of `X-Tool-Secret` with the Secret dropdown separately pointing at that secret for its value. A header name containing a space isn't valid HTTP, so every call to that tool failed *before leaving ElevenLabs' servers* — nothing reached this app at all, which is why it showed zero trace in `call_log`/container logs despite genuinely being called. The tell-tale symptom was an error surfaced by ElevenLabs' own "test tool individually" button (see Debugging section below): `invalid header field name "New secret"`.
- A body parameter schema matching the request shape above. Each property's **Identifier** must be the exact bare field name (e.g. `phone`, not `{ "phone": string }` — the data type is already declared by a separate dropdown; the Identifier field is only the JSON key name)
- For `lookup_customer`'s `phone` parameter specifically: **Value Type** must be set to **"Dynamic Variable"** (not the default "LLM Prompt"), with the variable name entered as the bare identifier `system__caller_id` — **no `{{ }}` braces** in this field, since it's a dedicated variable picker, not free text. This matters: with "LLM Prompt" left selected, the model has to infer a phone number from the transcript, and since the caller never states their number out loud, the model has nothing to fill the field with and silently never calls the tool at all — this is exactly what happened during initial testing (`lookup_customer` never once appeared in `call_log` across several test calls, only `check_availability`/`create_lead` did, until this was fixed). The `{{system__caller_id}}` `{{ }}` syntax is only used when referencing a dynamic variable inside free text, e.g. inside the system prompt.
- **Data types matter for validation**: this server's body schemas are strict about JSON types (e.g. `isEmergency` must be a real boolean). ElevenLabs' tool-calling has been observed sending boolean-typed fields as the strings `"true"`/`"false"` rather than a JSON boolean — confirmed by a real `create_lead` call that 400'd with `"isEmergency":["Expected boolean, received string"]`. The server now coerces string `"true"`/`"false"` to boolean before validating (see `booleanish` in [`tools/createLead.ts`](../src/tools/createLead.ts)) rather than assuming the dashboard will always send the "correct" JSON type — a good pattern to repeat for any new boolean/number fields added later.

### Emergency transfer

A built-in **system tool**, `transfer_to_number` (labeled "Transfer to number" in the dashboard, under Human Transfer Rules) — not a webhook tool, no code involved. Configured with:
- Transfer type: **Conference** (agent bridges the call to a human, can play a handoff message, then drops off — chosen over "Blind" for a smoother handoff)
- Destination: the emergency phone number, in E.164 format (e.g. `+19412259610`) — same number stored as `operational.emergencyTransferNumber` in `/settings`, but note this is a **separate, manual entry in the ElevenLabs dashboard** — changing the number in `/settings` does not automatically update this rule, since ElevenLabs doesn't read our settings store
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
