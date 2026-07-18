# Dynamic memory (cross-call memory by phone number)

When the same phone number calls a business again, the agent gets a short summary of what was discussed on their previous call, surfaced via the same `lookup_customer` tool call that already runs silently at the start of every call. Opt-in per business (`operational.dynamicMemoryEnabled`, one checkbox on General Settings, default off).

**Status: fully built and live for any business that enables the toggle (2026-07-18).** No separate webhook, no ElevenLabs Security-tab configuration — see "Final design" below for why, and "Rejected design" for the approach that was tried first and abandoned after a real production incident.

## Final design — piggyback on the existing `lookup_customer` tool

[elevenlabs-tools.md](elevenlabs-tools.md) already documents `lookup_customer`: a normal **webhook tool** (not a live-call-answering-path webhook) that the agent's system prompt instructs it to call silently as the very first action on every call, using the caller's phone number — which arrives for free via ElevenLabs' built-in `system__caller_id` dynamic variable, no configuration needed. It already looks up the caller in ServiceTitan and returns `{ found, customerId, name, address, email, equipmentAge }`, which the agent uses to greet a known caller by name.

Dynamic memory extends this same response with one more field, `lastCallSummary`:

```ts
// src/tools/lookupCustomer.ts
let lastCallSummary: string | null = null;
if (isDynamicMemoryEnabled(business.id)) {
  try {
    const memory = getCallMemory(business.id, phone);
    lastCallSummary = memory?.lastSummary ?? null;
  } catch (error) {
    console.error("getCallMemory failed, proceeding without it:", error);
  }
}
const response = { ...result, lastCallSummary };
```

The memory read is wrapped in its **own** try/catch, separate from the ServiceTitan lookup's — so a `call_memory` read failure only means a missing `lastCallSummary` field, never a failed customer lookup (which would otherwise lose the name/address greeting too, a regression this feature must never cause).

**Why this is safe in a way the rejected design (below) fundamentally wasn't**: `lookup_customer` is a normal mid-conversation tool call, the exact same mechanism `create_lead`/`book_job`/`check_availability` already use in production. A tool-call failure just becomes an error result handed back to the LLM — the agent's existing system prompt already has a rule for this class of thing ("never let a tool failure dead-end the call"). There is no known failure mode where a `lookup_customer` error takes down the call itself, unlike the personalization webhook (see below), which does exactly that.

**Setup required, once the toggle is on**: a small system-prompt addition on ElevenLabs' side, e.g. *"if `lastCallSummary` is non-empty, acknowledge what was discussed last time before continuing."* No dashboard webhook configuration, no Security-tab toggle, no separate verification stage — this reuses infrastructure that's already configured and already proven for every business already using `lookup_customer`.

## Schema — `call_memory` table (unchanged from the original design)

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

## The opt-in toggle

`operational.dynamicMemoryEnabled` (default off) gates both sides: the write hook in `postCall.ts` skips writing a memory row entirely when off, and `lookup_customer` never reads `call_memory` or includes `lastCallSummary` in its response when off (the field is simply omitted, not sent as `null` — see the code above, it's actually always present but `null` when disabled or when no prior memory exists; either way the agent's prompt only acts on a non-empty value). No live-call-answering-path risk means this toggle no longer needs to double as an emergency kill switch the way the rejected design required — it's just a normal feature flag.

## Write-side hook — reuses data already in hand

`webhooks/postCall.ts`'s `updateLeadWithRealSummary`/`updateJobWithRealSummary` already parse `request.phone` out of the logged tool-call payload to rebuild the ServiceTitan lead/job summary once the real AI `transcript_summary` arrives. Dynamic memory's write side reuses that exact same already-parsed, already-validated `request.phone` — no new field extraction was needed. (The post-call webhook payload's own `metadata.phone_call` object was checked directly and only ever carries `call_sid`, never a phone number — an earlier draft of this design assumed otherwise and was corrected before implementation.)

```ts
if (isDynamicMemoryEnabled(businessId)) {
  upsertCallMemory(businessId, request.phone, aiSummary);
}
```

Wrapped in the same "log and never throw" try/catch already used in that function — this runs after the call, not on the live-call path.

**Known, accepted limitation**: a call that never reached `create_lead`/`book_job` has no `phone` anywhere in this app and won't get a memory row — the same already-accepted gap [call-dashboard.md](call-dashboard.md) documents for Call History generally.

## Rejected design — ElevenLabs' personalization webhook (2026-07-18 incident)

The original design used ElevenLabs' [Twilio personalization / conversation-initiation webhook](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization) — the mechanism that fires *before* the agent greets the caller, on the live call-answering path. This section is kept as a record of why that approach was abandoned, in case it's ever reconsidered.

**This is the same webhook** [call-dashboard.md](call-dashboard.md#why-polling-not-a-webhook--a-real-incident-and-what-was-actually-tried) already evaluated and rejected once before, for the call-recording feature — that rejection had an alternative (Twilio polling). This one didn't: there's no polling equivalent for injecting a dynamic variable before the greeting.

**Real incident**: while beginning manual verification of this approach, the ElevenLabs Security-tab toggle ("fetch conversation initiation data for inbound Twilio calls") was enabled directly on **TitanZ's real production agent**, pointed at a Beeceptor endpoint with no mock rule configured (so it returned Beeceptor's generic default body, not the shape ElevenLabs expects). **Every inbound call to TitanZ failed immediately.** Toggling the setting back off restored calls immediately.

This settled the question this approach's whole design hinged on: **the webhook fails closed, not open.** A malformed response doesn't degrade to "no personalization" — it fails the call outright. ElevenLabs' own docs confirm nothing better is documented (no fallback/retry behavior for a bad response, only a vague "respond within a reasonable timeout" caution with no duration given) and additionally require the response's `dynamic_variables` field to contain the agent's **entire** defined set of dynamic variables, not just the one field a handler cares about — a second, independent way to fail a call by omission.

Given that, shipping this approach would have meant a business's inbound call availability depending on this app's own webhook endpoint being correct and reachable 24/7, forever — not "best effort personalization, worst case a generic greeting." Once the `lookup_customer`-based design (above) was identified as a viable alternative that avoids the live-call-answering path entirely, there was no reason to accept that risk, so this approach was dropped rather than hardened further.
