# Per-call record page

A single-call detail page — `https://dashboard.laughslapper.com/b/{businessId}/calls/{conversationId}` — showing everything about one AI-handled call: recording, transcript, AI summary, whether it was transferred, and a link to the ServiceTitan Lead it produced. The link isn't just meant to be pasted in manually either: `create_lead`'s Lead summary now includes this same link automatically as a "Call Details" line (see [servicetitan-integration.md](servicetitan-integration.md#3-lead-creation--createleadbusinessid-input)), built from `getDashboardBaseUrl(businessId)`.

There's also a **flagged calls list** — `https://dashboard.laughslapper.com/b/{businessId}/calls` — a login-gated (unlike the detail pages) overview of recent calls with automated flags for the ones worth a human's attention, so staff aren't manually scanning every transcript. See [Flagged calls list](#flagged-calls-list) below.

This page is scoped to one business at a time (`:businessId` in the path) — see [architecture-overview.md](architecture-overview.md) for the platform's multi-business model. Every table/lookup this page depends on (`elevenlabs_calls`, `call_log`) is filtered by that business's ID, not just `conversationId` alone, so a conversation ID belonging to one business can never be viewed through another business's path.

## Why this needed a new data pipeline

The three ElevenLabs tool webhooks (`lookup_customer`/`check_availability`/`create_lead`, see [elevenlabs-tools.md](elevenlabs-tools.md)) only fire *during* a call, for specific actions the agent decides to take. They give us zero visibility into the recording, the full transcript, the AI-generated summary, or how/why the call ended. That data only exists in ElevenLabs' **post-call webhooks** — a completely separate mechanism that fires once, after the call is already over.

## Two webhook event types, one endpoint

`POST /b/:businessId/webhooks/elevenlabs/post-call` ([`webhooks/postCall.ts`](../src/webhooks/postCall.ts)) receives both of ElevenLabs' post-call webhook types, distinguished by a `type` field in the payload:

- **`post_call_transcription`** — `data.conversation_id`, the full `transcript` array (each turn has `role`, `message`, `time_in_call_secs`, and optionally `tool_calls`), `data.analysis.transcript_summary`, and `data.metadata.termination_reason`. Upserted into the `elevenlabs_calls` table via `upsertCallTranscription()`.
- **`post_call_audio`** — a *separate* webhook delivery, `data.conversation_id` + `data.full_audio` (base64-encoded MP3, the entire call). Decoded and written to `data/recordings/{conversationId}.mp3` (inside the same Docker volume as everything else — no docker-compose changes needed), path recorded via `setCallAudioPath()`.

These two can arrive in either order (or one without the other, e.g. if only transcription webhooks are enabled) — both DB helpers `INSERT ... ON CONFLICT DO UPDATE` on `conversation_id` so neither clobbers the other's half of the row. The **entire raw payload** is also stored (`raw_payload_json`), not just the fields we picked out — ElevenLabs' documentation didn't fully specify `termination_reason`'s possible values or exactly how a `transfer_to_number` invocation shows up structurally, so nothing is lost if the initial field-mapping turns out to need adjusting once real payloads are seen.

**This handler now also writes back to ServiceTitan, not just to our own database.** If `analysis.transcript_summary` is present on the `post_call_transcription` payload, `updateLeadWithRealSummary()` looks up the Lead this call created (via the same `call_log` correlation `findCreateLeadLogByConversationId()` uses elsewhere) and updates that Lead's summary to swap in the real AI summary in place of the short placeholder narrative used at creation time — see [servicetitan-integration.md](servicetitan-integration.md#3-lead-creation--createleadbusinessid-input) for the full two-phase design. A failure here (including "no lead was ever created for this call") is logged and doesn't affect this endpoint's response to ElevenLabs.

## Signature verification — implemented directly, not via SDK

ElevenLabs signs these requests with an `elevenlabs-signature` header, but their prose docs don't spell out the exact algorithm — so this was confirmed by reading their **official JS SDK's source** (`WebhooksClient.constructEvent` in `@elevenlabs/elevenlabs-js`) rather than guessing. The scheme, Stripe-style:

```
header:  t=<unix_seconds>,v0=<hex_signature>
signed message: "<unix_seconds>.<raw_request_body>"
signature: hex(HMAC-SHA256(secret, message))
tolerance: reject if the timestamp is more than 30 minutes old (replay protection)
```

Implemented directly with Node's built-in `crypto` in [`webhooks/signature.ts`](../src/webhooks/signature.ts) — the `@elevenlabs/elevenlabs-js` package was evaluated and **deliberately not added as a dependency**, since the verification logic is a few lines of `crypto.createHmac`, consistent with how this project already does AES-256-GCM encryption and scrypt password hashing with zero crypto libraries beyond Node's own.

**This requires the raw, unparsed request body**, which Express's `express.json()` normally discards after parsing. [`index.ts`](../src/index.ts) captures it for every request via the `verify` callback: `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })` — a small addition to already-shared middleware, not a route-specific hack.

The signing secret is a per-business field ("Post-call webhook secret" on `/b/:businessId/settings`), same encrypted-storage pattern as every other credential — just a plain save, deliberately **without** a "generate random" button. That pattern exists for the tool webhook secret because we invent that value and paste it into ElevenLabs; here the relationship is reversed — ElevenLabs generates this secret when you create the webhook (HMAC auth method), and you paste *its* value into that business's settings. A "generate random" button here would silently create a value that no longer matches what ElevenLabs actually signs with, breaking verification — so it was removed after initially being added by mistake, mirroring the tool-secret flow without checking whether that pattern actually applied. Each business has its own secret — a payload signed with business A's secret is rejected at business B's webhook path, and vice versa.

### Configuring this in the ElevenLabs dashboard — the exact path

This took real trial and error to find, since ElevenLabs' webhook configuration is split across multiple screens that look similar but aren't. In order:

1. **Workspace Settings → Webhooks → Create a Webhook.** Give it a name (e.g. "Post-call transcription"), set the callback URL to `https://voiceagent.laughslapper.com/b/:businessId/webhooks/elevenlabs/post-call` (with that business's real numeric ID in place of `:businessId`), and set **Webhook Auth Method: HMAC** — this generates the shared secret shown once, which goes into that business's own settings page. **This step alone does nothing** — creating the endpoint here doesn't attach it to anything yet.
2. Still in Workspace Settings, there's a general **"Post-Call Webhook"** section with a "Select Webhook" dropdown — this sets the *workspace default*. Selecting it here looked right but a checkbox change here (specifically toggling "Audio") didn't persist across refreshes for us — possibly a per-agent-override quirk, possibly a UI bug, unconfirmed.
3. **The step that actually mattered: the agent's own "Security" tab** (not in the main left-sidebar list alongside Agent/Workflow/Tools/etc. — it's nested further in) has its **own** Post-Call Webhook selector, with **"Webhook Events"** checkboxes for **Transcript** and **Audio**, and its own save action. This is the one that needs Transcript (required) and Audio (if you want recordings) checked, and needs to actually persist a real save — confirmed working once done here specifically, not at the workspace-level screen from step 2.
4. Don't confuse any of this with **"Add webhook tool"** (a tool the LLM calls mid-conversation) or a **Speech-to-Text API webhook** ("Transcription completed" under a generic endpoint's event checkboxes) — both surfaced during setup and look superficially similar but are unrelated features.
5. **The "Audio" checkbox specifically got stuck once**: it showed as checked and survived a refresh, yet no `post_call_audio` webhook ever arrived across two full test calls (confirmed via `audio_path` staying `null` in `elevenlabs_calls`) even after re-publishing the agent. What fixed it: **unchecking "Audio," saving/publishing, then re-checking it and saving/publishing again** — a full off→on cycle, not just confirming it was already on. Recording delivery worked immediately on the next call after that. If audio ever silently stops arriving again, this toggle-cycle is the first thing to try before assuming a deeper problem.

### Range request support (kept, though not the cause of the symptom that prompted it)

A recording was initially reported as "cut off after 3 seconds" — that turned out to actually just be a genuinely 3-second test call (confirmed identical against ElevenLabs' own recording of the same conversation), not a truncation bug. While investigating it, though, a real gap was found and is worth keeping fixed regardless: `<audio>` elements stream via HTTP **Range requests** (fetching a file incrementally), and the audio route originally served the whole file with a plain `200` regardless of any `Range` header. Fixed in `dashboard/routes.ts`'s `/b/:businessId/calls/:conversationId/audio` handler: it now inspects the `Range` header and responds `206 Partial Content` with the exact requested byte range (via `fs.createReadStream(path, { start, end })`) when present, and advertises `Accept-Ranges: bytes` on the full-file response too. Verified locally against both a plain request and an explicit `Range: bytes=0-99` request.

### The real audio bug: Express's 100kb body limit

Short test calls' audio arrived fine; real-length calls' never did — `audio_path` stayed `null` with no error visible anywhere. Cause: Express's `express.json()` defaults to a **100KB request body limit**. `post_call_audio` webhooks carry the entire call's recording base64-encoded inline in the JSON body — trivial for a few seconds of audio, but a real conversation's audio easily exceeds 100KB, silently rejected before ever reaching the webhook handler (no log line, no error — the request never got past Express's body parser). Fixed with `express.json({ limit: "50mb", ... })` in [`index.ts`](../src/index.ts). Verified locally by sending a signed 1.4MB payload (well over the old default) and confirming it's accepted and the decoded file is written correctly.

#### If a call's recording ever goes missing again (max length reached)

The `50mb` cap is what limits how long a single call's recording can be before its post-call webhook gets silently rejected the same way the 100KB default did. To raise it:

1. Open [`src/index.ts`](../src/index.ts) and find the `express.json({ limit: "50mb", ... })` call near the top.
2. Change `"50mb"` to a larger value (Express accepts strings like `"100mb"`) — no other file needs to change; Caddy and Docker don't impose their own body-size limits here, so this one setting is the only cap in the whole request path.
3. Rebuild and redeploy (`docker compose up -d --build`).

Rough sizing: base64 encoding inflates the raw audio by ~33%, so a `50mb` limit holds roughly ~37MB of actual MP3 data before the 33% overhead. At typical phone-call-quality bitrates this comfortably covers well over an hour of audio — if you're hitting the limit, it likely means either a genuinely very long call, or ElevenLabs encoding at a much higher bitrate than expected. The symptom to watch for is the same as the original bug: `audio_path` stays `null` for a specific call with no error anywhere in `docker compose logs app`, since an oversized request is rejected before our code ever logs anything about it.

If a future ElevenLabs redesign moves the webhook-configuration UI around again, the way to confirm it's working regardless of where the toggle lives: place a test call, then check whether a new row landed in `elevenlabs_calls` (`docker compose exec app node -e "..."`, querying that table) — an empty result means the webhook isn't actually configured to fire yet, no matter what the dashboard UI appears to show.

## Correlating with our own data — by conversation ID, not re-extraction

Name, phone, address, and whether it was an emergency all already flow through our own `create_lead` tool call during the conversation — there was no reason to have ElevenLabs re-extract the same information via their separate Data Collection feature. Instead:

- `create_lead`'s tool schema gained an optional `conversationId` field ([`tools/createLead.ts`](../src/tools/createLead.ts)), bound on the ElevenLabs side to the built-in dynamic variable **`system__conversation_id`** (same technique as `phone` → `system__caller_id` elsewhere) — confirmed to exist via ElevenLabs' dynamic-variables docs.
- It rides along in the already-logged request JSON in `call_log` — no schema change needed there.
- [`db/callLog.ts`](../src/db/callLog.ts)'s `findCreateLeadLogByConversationId()` does a `LIKE '%conversationId%'` match against `request_json` to find the right row — a plain substring match rather than a dedicated indexed/extracted column, since conversation IDs are unique enough that false positives aren't a practical concern at this scale.
- [`dashboard/callDetails.ts`](../src/dashboard/callDetails.ts)'s `buildCallDetailViewModel()` joins the `elevenlabs_calls` row with that `call_log` row to assemble everything the page needs — this is the one function to look at if a field on the page is wrong or missing.

## Known gaps to verify against a real call

- **`termination_reason` values** are stored raw/unmapped — confirmed via a real call to be a plain descriptive sentence (e.g. `"end_call tool was called."`), not a short enum code, so displaying it raw (as currently implemented) reads fine as-is with no mapping needed.
- **Transfer detection — confirmed against a real transferred call, and previously broken.** An earlier version of `findTransferInfo()` looked for `tool_calls[].name`/`params`/`parameters` — none of which exist in ElevenLabs' real payload shape. The actual fields are `tool_name` and a JSON-encoded `params_as_json` string (confirmed against a real Emergency Dispatch call transcript where the agent attempted a `transfer_to_number`). This meant the "Is Transferred"/"Transfer Destination" rows had silently shown "No"/"—" for every call, including ones where a transfer genuinely happened, since it was first built — fixed once real data was available to check it against. It also now distinguishes `transfer_to_number` (a real human/phone transfer) from `transfer_to_agent` (internal multi-agent workflow routing between nodes, which always reports success and isn't a transfer a caller would notice) — only the former is ever reported, and a `tool_results` entry with `is_error: true` for it now shows as "Attempted — failed" rather than the same "Yes" as a successful transfer.
- **The ServiceTitan Lead URL** — confirmed working against a real sandbox lead, with one correction: the web UI hostname differs by environment. Integration/sandbox tenants live at `integration.servicetitan.com`, production at `go.servicetitan.com` (the pattern originally assumed for all environments, based on a reference screenshot from a different integration). `callDetails.ts` now picks the right host from the `servicetitan.environment` setting (`ST_WEB_HOSTS` map) rather than hardcoding production's domain.
- **Company name is the business's own name** — `callDetails.ts` uses `business.name` (the same value shown on the business list and its settings page) rather than a separate cosmetic field, ever since this became a multi-business platform. A typo when adding a business shows up here publicly; see [settings-app.md](settings-app.md#businesses) for how to fix one.
- **Call Time is displayed in a configurable time zone** — `operational.timezone` on that business's `/b/:businessId/settings` page ("Dashboard display time zone", defaults to `America/New_York`), read via `getAgentTimezone(businessId)` in `settings/store.ts` and used by `dashboard/views.ts`'s `formatCallTime()`. `received_at` is stored as SQLite's `datetime('now')`, which is UTC with no timezone marker; `formatCallTime()` parses it explicitly as UTC before converting for display (`new Date(sqliteDatetime.replace(" ", "T") + "Z")`), then renders via `toLocaleString("en-US", { timeZone })`. **This is deliberately separate from ElevenLabs' own per-agent time zone setting**, which controls the agent's time-awareness *during* a call (greetings, business hours, relative dates like "tomorrow"). Our setting only affects how already-completed calls' timestamps are formatted on this dashboard — the two don't interact, so changing one has no effect on the other. Labeled explicitly in the settings UI to avoid the two being mistaken for the same setting.
- **Phone numbers are reformatted for display only** (`formatPhoneNumber()` in `views.ts`) as `+1(XXX) XXX-XXXX`, applied to both the "Phone" and "Forwarded Phone Number" rows — the underlying stored value is untouched, this only affects rendering. Falls back to displaying the raw value unchanged for anything that isn't a recognizable 10-digit US number (e.g. an already-malformed or international number), rather than mangling it.
- **`conversation_id`'s actual entropy is unverified** — since these pages are now public and this ID is the *only* thing standing between the internet and a call's PII (see [Auth and access](#auth-and-access--fully-public-by-design) below), it's worth confirming against a real payload that ElevenLabs' conversation IDs are actually long/random enough to be safely unguessable, the same way `termination_reason` and transfer detection were confirmed against real calls rather than assumed.

## Auth and access — fully public, by design

`/b/:businessId/calls/*` has **no login gate at all** — `dashboard/routes.ts` deliberately does not apply `requireAdminSession`. These pages are meant to be pasted into a ServiceTitan lead's notes and opened by any staff member (dispatchers, techs) who don't have — and shouldn't need — a login to this app. The trust model is the same as an unlisted YouTube video: the URL itself (`businessId` + ElevenLabs' own `conversation_id`) is the *only* access control. Anyone holding the exact link can view the transcript, recording, summary, and customer PII on that page, indefinitely, with no login. `businessId` alone isn't a secret (business IDs are small sequential integers) — `getCallRecord()`/`findCreateLeadLogByConversationId()` still require both the right `businessId` *and* the right `conversation_id` to match a row, so guessing a low business ID gets you nothing without also knowing a real conversation ID for it.

**This means there is no audit trail of who viewed a given call's PII.** That's an accepted, permanent consequence of "anyone with the link," not a gap intended to be closed later — don't reflexively add a login gate back without revisiting this decision first. The flagged calls list (below) *is* a browsable view of every call, and does bring its own explicit `requireAdminSession` for exactly this reason — a browsable list is a fundamentally different exposure than one opaque per-call link, so it doesn't get the same "no login" treatment.

Since the link is the only secret, `dashboard/routes.ts` hardens it accordingly:
- **`X-Robots-Tag: noindex, nofollow`** on every response from this router (HTML page and the binary audio route alike) — these pages must never be *discoverable* (e.g. crawled/indexed), only reachable by someone who already has the exact link.
- **`Referrer-Policy: no-referrer`**, plus `rel="noopener noreferrer"` on both "View Lead in ST" anchors in `views.ts` — the conversation ID lives in this page's own URL, so without this, clicking through to ServiceTitan would leak that URL (the secret) to ServiceTitan's server via the `Referer` header. Deliberately redundant (header + anchor attribute) rather than relying on just one.
- **Per-IP rate limiting** (`middleware/dashboardRateLimiter.ts`): 30 requests/5min on the HTML page, 300 requests/5min on the audio route (kept separate and much higher, since one real `<audio>` playback issues many legitimate Range sub-requests as the browser seeks/streams). This throttles scanning/noise and bounds worst-case load — it is **not** the load-bearing defense against someone guessing a valid `conversation_id`. That's the ID's own entropy (see [Known gaps](#known-gaps-to-verify-against-a-real-call) above).
- The ID used in the URL is ElevenLabs' own `conversation_id` — no separate "share token" was minted for this. That matches the mental model directly (a YouTube video's ID is simultaneously its internal and shareable identifier) and preserves every link already pasted into ServiceTitan notes before this change. The tradeoff: this codebase hasn't independently verified `conversation_id`'s actual entropy/length/character set against a real payload, unlike other ElevenLabs assumptions here — flagged in Known gaps above as something to confirm once a real ID is in hand, rather than pre-building a token migration for a problem that may not exist.

Note that `/settings` (and its multi-user login + brute-force lockout) and `/b/:businessId/tools/*` (the shared-secret-authenticated tool webhooks) are untouched by any of this — this is scoped entirely to the two `/b/:businessId/calls/*` routes.

## Deployment

Same app container, one more Caddy site block:
```
dashboard.laughslapper.com {
	reverse_proxy app:3000
}
```
Caddy auto-provisions a separate Let's Encrypt cert for this second hostname. Express doesn't branch on hostname at all — `/b/:businessId/calls/*` would work identically on either domain; `dashboard.laughslapper.com` is just the intended/documented one. Requires one more DNS A record (`dashboard` → the same VPS IP), same as `voiceagent` was added earlier. Adding a new business needs **no** Caddy/DNS changes at all — its `:businessId` is just a different path segment on the same domain.

## Flagged calls list

`GET /b/:businessId/calls` ([`dashboard/routes.ts`](../src/dashboard/routes.ts)) — a login-gated overview of the most recent 50 calls (`listCallRecords()` in [`db/callRecords.ts`](../src/db/callRecords.ts), no pagination yet, revisit only if that limit becomes a real constraint), each annotated with automated flags computed purely from data already stored — no new AI/ML involved. `requireAdminSession` is applied to this **one route only**, not the whole `dashboardRouter` — the detail/audio routes stay public exactly as before.

`computeCallFlags()` in `callDetails.ts` derives three flags per call:
- **Failed transfer** — the transcript's `tool_results` contains a `transfer_to_number` entry with `is_error: true`.
- **No lead created** — the transcript shows real activity (a `lookup_customer` tool call) but `findCreateLeadLogByConversationId()` finds no corresponding `create_lead` row for that conversation. Deliberately narrow: a call that hung up before any real activity (e.g. an immediate wrong-number hangup) isn't flagged for a lead it was never going to produce.
- **Ended early** — `termination_reason` is exactly `"Call ended by remote party"` (the caller hanging up before the agent wrapped up on its own), as opposed to the normal `"end_call tool was called."` This one is shown as a softer signal (amber badge) rather than an alarm (red), since it can mean either a real problem or just a wrong number.

All three were confirmed against a real flagged call (the Emergency Dispatch burning-smell test — see [servicetitan-integration.md](servicetitan-integration.md) and [elevenlabs-tools.md](elevenlabs-tools.md) for that flow) before being built, not guessed.

## Deferred

- Pagination on the flagged calls list, if 50 recent calls stops being enough.
- Real-time/automatic Lead→Job conversion tracking (the ST link always points at the Lead we create, never a Job).
