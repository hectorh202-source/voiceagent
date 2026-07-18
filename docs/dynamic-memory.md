# Dynamic memory (cross-call memory by phone number)

When the same phone number calls a business again, the agent gets a short summary of what was discussed on their previous call — fed in as a dynamic variable (`customer_memory`) at the start of the new call, before the agent greets them. Opt-in per business (`operational.dynamicMemoryEnabled`, default off).

**Status: Stage 1 only (schema, toggle, write-side hook) is built and live for any business that enables it. Stage 2 — the webhook that actually delivers the memory into a live call — is deliberately not built yet.** See "Why this is staged" below before touching this feature.

## Why this is staged, not built in one pass

Delivering a dynamic variable into a live inbound call before the agent speaks requires ElevenLabs' [Twilio personalization / conversation-initiation webhook](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization) — the **only** documented mechanism for this. There is no polling equivalent; the data has to be present at greeting time.

This is the *same webhook* [call-dashboard.md](call-dashboard.md#why-polling-not-a-webhook--a-real-incident-and-what-was-actually-tried) already evaluated and explicitly rejected once before, for the call-recording feature: *"That webhook sits directly on the live call-answering path — a wrong response shape, a slow response, or an error could plausibly delay or break every inbound call across every business, and its documented failure-mode behavior... isn't specified anywhere."* That rejection had an alternative (Twilio polling). **There is no alternative here.** If this feature exists at all, this webhook is not optional — so everything about Stage 2's design has to make the worst case ("this webhook misbehaves") degrade to "the caller doesn't get a personalized greeting," never "the call is delayed or dropped."

Rather than write handler code against an assumed contract (this webhook's auth mechanism, exact request shape beyond the documented fields, and real timeout/failure behavior are all unconfirmed), Stage 0 requires one real manual test against a real ElevenLabs agent first — mirroring the same discipline [google-lsa-leads.md](google-lsa-leads.md#sequencing--why-this-needed-a-manual-setup-stage-first) used before writing any Google Ads field-mapping code.

## Stage 0 — manual verification checklist (not yet done — blocks Stage 2)

This needs to be done once, against one real ElevenLabs agent (a test/throwaway agent is fine — this doesn't need to be TitanZ's production agent), before `src/webhooks/personalizationWebhook.ts` gets written:

1. **Stand up a temporary echo/inspection endpoint** that logs the full incoming request (headers + body) and responds with a valid `{"type": "conversation_initiation_client_data", "dynamic_variables": {}}` — a free tool like [Beeceptor](https://beeceptor.com) or [webhook.site](https://webhook.site) works, or a throwaway route on this app's own dev server if it's reachable from the internet.
2. **In that agent's ElevenLabs dashboard, Security tab**, enable "fetch conversation initiation data for inbound Twilio calls" and point it at the echo endpoint.
3. **Place one real inbound test call** to that agent's number.
4. **Report back three things** from what the echo endpoint actually captured:
   - **Auth**: does the request carry any signature/token/header that isn't just standard HTTP (e.g. an HMAC signature like the post-call webhook's `elevenlabs-signature`, a static bearer token configurable in the same dashboard field, or nothing at all)?
   - **Exact request shape**: confirm `caller_id`/`agent_id`/`called_number`/`call_sid` are present as documented, and note anything else present that isn't documented.
   - **Failure-mode behavior**: repeat the test call at least once against a deliberately slow (delay the response by several seconds) or malformed (wrong JSON shape, non-200 status) echo response, and note what actually happens to the call — does it proceed with a generic greeting, hang, or drop?

Once this is reported back, Stage 2 gets built against the real, confirmed contract instead of an assumed one.

## Stage 1 — built now, safe regardless of Stage 0's outcome

### Schema — `call_memory` table

```sql
CREATE TABLE IF NOT EXISTS call_memory (
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  phone_lookup_hash TEXT NOT NULL,
  last_summary TEXT,
  last_call_at TEXT NOT NULL DEFAULT (datetime('now')),
  call_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (business_id, phone_lookup_hash)
);
```

**Why a hash instead of the encrypted phone number directly.** This app's encryption scheme ([sqlite-storage.md](sqlite-storage.md)) is AES-256-GCM with a random IV per encryption — the same plaintext produces different ciphertext every time, so an encrypted column can never be looked up via `WHERE col = ?`. Every other PII column in this codebase is only ever filtered by `id`/`business_id`, never searched by its own value — this table's entire purpose (look up a caller's prior context *by* their incoming phone number) is the one place that trap would actually bite. `phone_lookup_hash` is a deterministic `SHA-256` of the normalized last-10-digits (same normalization `twilio/pollCalls.ts` already uses), giving an indexable, searchable key without storing the raw number at all — not strong anonymization (US phone numbers are low-entropy enough to be rainbow-table-able), just a pragmatic way to avoid storing/searching raw PII directly, acceptable since the actual content (`last_summary`) stays properly encrypted and v1 never needs to display the phone number back anywhere.

`src/db/callMemory.ts` — `upsertCallMemory(businessId, phone, summary)` (upsert incrementing `call_count`) and `getCallMemory(businessId, phone)` (hash + lookup + decrypt).

### The opt-in toggle is the real kill switch, not just a hint

`operational.dynamicMemoryEnabled` (default off, one checkbox on General Settings) doesn't just gate whether this app *writes* memory — it's designed to be the actual safety boundary for Stage 2 too, because this app can't control whether a stale/misconfigured ElevenLabs dashboard keeps calling the personalization webhook after someone disables this feature here. So Stage 2's webhook (once built) must check this toggle server-side on every request and always return `200` with an empty-memory payload when disabled — never `404` (a 404 is itself a "wrong response shape" on the live-call path). Flipping this toggle off is then a reliable kill switch regardless of what's configured on ElevenLabs' side.

### Write-side hook — reuses data already in hand

`webhooks/postCall.ts`'s `updateLeadWithRealSummary`/`updateJobWithRealSummary` already parse `request.phone` out of the logged tool-call payload to rebuild the ServiceTitan lead/job summary once the real AI `transcript_summary` arrives. Dynamic memory's write side reuses that exact same already-parsed, already-validated `request.phone` — no new field extraction was needed. (The post-call webhook payload's own `metadata.phone_call` object was checked directly and only ever carries `call_sid`, never a phone number — an earlier draft of this design assumed otherwise and was corrected before implementation.)

```ts
if (isDynamicMemoryEnabled(businessId)) {
  upsertCallMemory(businessId, request.phone, aiSummary);
}
```

Gated by the same toggle, wrapped in the same "log and never throw" try/catch already used in that function — this runs after the call, not on the live-call path, so it only needs that file's existing defensive style, not Stage 2's fail-open urgency.

**Known, accepted limitation**: a call that never reached `create_lead`/`book_job` has no `phone` anywhere in this app and won't get a memory row — the same already-accepted gap [call-dashboard.md](call-dashboard.md) documents for Call History generally.

## Stage 2 — not built yet (blocked on Stage 0)

Once Stage 0 reports back, `src/webhooks/personalizationWebhook.ts` gets built with this fail-open shape — every fallible operation (DB read, decrypt, the Stage-0-confirmed auth check) inside one `try`, a single `catch` that only logs and falls through to the same hardcoded fallback, and a timeout around the DB read so a pathological slow read can't hang the response:

```ts
export async function handlePersonalizationWebhook(req: Request, res: Response): Promise<void> {
  const FALLBACK = { type: "conversation_initiation_client_data", dynamic_variables: { customer_memory: "" } };
  try {
    const business = req.business;
    if (!business || !isDynamicMemoryEnabled(business.id)) {
      res.status(200).json(FALLBACK);
      return;
    }
    // [Stage 0's confirmed auth check here — a failure falls through to
    // FALLBACK, never a 401/403; a legitimate ElevenLabs call must never
    // be blocked just because a secondary check disagrees.]
    // [agent_id cross-check against this business's own stored agentId —
    // mismatch logs + falls through to FALLBACK.]
    const memory = await withTimeout(getCallMemory(business.id, req.body.caller_id), 1500);
    const dynamicVariables = memory
      ? { customer_memory: `Returning caller — last call ${memory.lastCallAt}: ${memory.lastSummary}` }
      : { customer_memory: "" };
    res.status(200).json({ type: "conversation_initiation_client_data", dynamic_variables: dynamicVariables });
  } catch (error) {
    console.error("Dynamic memory webhook failed, responding with empty memory:", error);
    res.status(200).json(FALLBACK);
  }
}
```

Business resolution is via the URL path (`/b/:businessId/webhooks/elevenlabs/personalization`), not the payload — same pattern every other webhook in this app already uses — with the payload's own `agent_id` cross-checked against that business's stored `elevenlabs.agentId` as defense in depth (mismatch never returns real data, just the same fallback).

**Verification, once built**: kill-switch curl tests for both toggle states (including a deliberately-locked-DB test to prove the timeout path fires under real failure, not just the happy path), then one real two-call end-to-end test — call a number once (empty memory), let the post-call webhook land, call again (real context reflected in the greeting) — and confirm zero behavior change for every business that hasn't opted in.

## Agent prompt setup (manual, once Stage 2 ships)

No code changes an agent's own system prompt — that's a manual per-business ElevenLabs dashboard edit, since this app doesn't reliably know each business's existing prompt structure well enough to safely inject text into it. Whoever edits a business's prompt just needs the dynamic variable's name: `customer_memory`, e.g. "if `{{customer_memory}}` is non-empty, acknowledge the returning caller using that context."
