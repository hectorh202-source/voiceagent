# Per-call record page

A single-call detail page — `https://dashboard.laughslapper.com/calls/{conversationId}` — showing everything about one AI-handled call: recording, transcript, AI summary, whether it was transferred, and a link to the ServiceTitan Lead it produced. Meant to be linked to directly (e.g. pasted into a ServiceTitan lead's notes), not browsed from a list — there's no call-list/index view yet (see [Deferred](#deferred) below).

## Why this needed a new data pipeline

The three ElevenLabs tool webhooks (`lookup_customer`/`check_availability`/`create_lead`, see [elevenlabs-tools.md](elevenlabs-tools.md)) only fire *during* a call, for specific actions the agent decides to take. They give us zero visibility into the recording, the full transcript, the AI-generated summary, or how/why the call ended. That data only exists in ElevenLabs' **post-call webhooks** — a completely separate mechanism that fires once, after the call is already over.

## Two webhook event types, one endpoint

`POST /webhooks/elevenlabs/post-call` ([`webhooks/postCall.ts`](../src/webhooks/postCall.ts)) receives both of ElevenLabs' post-call webhook types, distinguished by a `type` field in the payload:

- **`post_call_transcription`** — `data.conversation_id`, the full `transcript` array (each turn has `role`, `message`, `time_in_call_secs`, and optionally `tool_calls`), `data.analysis.transcript_summary`, and `data.metadata.termination_reason`. Upserted into the `elevenlabs_calls` table via `upsertCallTranscription()`.
- **`post_call_audio`** — a *separate* webhook delivery, `data.conversation_id` + `data.full_audio` (base64-encoded MP3, the entire call). Decoded and written to `data/recordings/{conversationId}.mp3` (inside the same Docker volume as everything else — no docker-compose changes needed), path recorded via `setCallAudioPath()`.

These two can arrive in either order (or one without the other, e.g. if only transcription webhooks are enabled) — both DB helpers `INSERT ... ON CONFLICT DO UPDATE` on `conversation_id` so neither clobbers the other's half of the row. The **entire raw payload** is also stored (`raw_payload_json`), not just the fields we picked out — ElevenLabs' documentation didn't fully specify `termination_reason`'s possible values or exactly how a `transfer_to_number` invocation shows up structurally, so nothing is lost if the initial field-mapping turns out to need adjusting once real payloads are seen.

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

The signing secret is a new `/settings` field ("Post-call webhook secret"), same encrypted-storage pattern as every other credential, with its own "Generate a new random secret" button (`POST /settings/generate-post-call-secret`) mirroring the existing tool-webhook-secret flow.

### Configuring this in the ElevenLabs dashboard — the exact path

This took real trial and error to find, since ElevenLabs' webhook configuration is split across multiple screens that look similar but aren't. In order:

1. **Workspace Settings → Webhooks → Create a Webhook.** Give it a name (e.g. "Post-call transcription"), set the callback URL to `https://voiceagent.laughslapper.com/webhooks/elevenlabs/post-call`, and set **Webhook Auth Method: HMAC** — this generates the shared secret shown once, which goes into `/settings`. **This step alone does nothing** — creating the endpoint here doesn't attach it to anything yet.
2. Still in Workspace Settings, there's a general **"Post-Call Webhook"** section with a "Select Webhook" dropdown — this sets the *workspace default*. Selecting it here looked right but a checkbox change here (specifically toggling "Audio") didn't persist across refreshes for us — possibly a per-agent-override quirk, possibly a UI bug, unconfirmed.
3. **The step that actually mattered: the agent's own "Security" tab** (not in the main left-sidebar list alongside Agent/Workflow/Tools/etc. — it's nested further in) has its **own** Post-Call Webhook selector, with **"Webhook Events"** checkboxes for **Transcript** and **Audio**, and its own save action. This is the one that needs Transcript (required) and Audio (if you want recordings) checked, and needs to actually persist a real save — confirmed working once done here specifically, not at the workspace-level screen from step 2.
4. Don't confuse any of this with **"Add webhook tool"** (a tool the LLM calls mid-conversation) or a **Speech-to-Text API webhook** ("Transcription completed" under a generic endpoint's event checkboxes) — both surfaced during setup and look superficially similar but are unrelated features.
5. **The "Audio" checkbox specifically got stuck once**: it showed as checked and survived a refresh, yet no `post_call_audio` webhook ever arrived across two full test calls (confirmed via `audio_path` staying `null` in `elevenlabs_calls`) even after re-publishing the agent. What fixed it: **unchecking "Audio," saving/publishing, then re-checking it and saving/publishing again** — a full off→on cycle, not just confirming it was already on. Recording delivery worked immediately on the next call after that. If audio ever silently stops arriving again, this toggle-cycle is the first thing to try before assuming a deeper problem.

### Range request support (kept, though not the cause of the symptom that prompted it)

A recording was initially reported as "cut off after 3 seconds" — that turned out to actually just be a genuinely 3-second test call (confirmed identical against ElevenLabs' own recording of the same conversation), not a truncation bug. While investigating it, though, a real gap was found and is worth keeping fixed regardless: `<audio>` elements stream via HTTP **Range requests** (fetching a file incrementally), and the audio route originally served the whole file with a plain `200` regardless of any `Range` header. Fixed in `dashboard/routes.ts`'s `/calls/:conversationId/audio` handler: it now inspects the `Range` header and responds `206 Partial Content` with the exact requested byte range (via `fs.createReadStream(path, { start, end })`) when present, and advertises `Accept-Ranges: bytes` on the full-file response too. Verified locally against both a plain request and an explicit `Range: bytes=0-99` request.

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
- **Transfer detection is best-effort**: `findTransferInfo()` in `callDetails.ts` scans the transcript's `tool_calls` for anything with "transfer" in its name and pulls a phone-number-shaped field from its parameters. ElevenLabs doesn't document a dedicated top-level field for this, so this may need adjusting once a real transferred call's payload has been inspected.
- **The ServiceTitan Lead URL** — confirmed working against a real sandbox lead, with one correction: the web UI hostname differs by environment. Integration/sandbox tenants live at `integration.servicetitan.com`, production at `go.servicetitan.com` (the pattern originally assumed for all environments, based on a reference screenshot from a different integration). `callDetails.ts` now picks the right host from the `servicetitan.environment` setting (`ST_WEB_HOSTS` map) rather than hardcoding production's domain.
- **Company name is hardcoded** ("TitanZ Plumbing and Air Conditioning") in `callDetails.ts` — not a `/settings` field, since it's cosmetic and not tenant-configurable elsewhere yet.

## Auth and access

`/calls/*` routes require the same admin session as `/settings` (`requireAdminSession` middleware) — these pages show real customer PII (name, phone, address, call recordings), so they're gated the same way credentials are, not left open just because they're meant to be linked from ServiceTitan.

One UX gap this surfaced and fixed: `requireAdminSession` previously always redirected to a bare `/settings/login` with no memory of where you were headed, which is fine for `/settings` itself (nobody deep-links into it) but wrong for `/calls/:id` links opened cold. It now redirects to `/settings/login?returnTo=<original path>`, threaded through the login form as a hidden field and validated as a same-site relative path before being used as the post-login redirect target (guards against an open-redirect via a crafted `returnTo` value) — see `requireAdminSession.ts` and the `/login` handlers in `settings/routes.ts`.

## Deployment

Same app container, one more Caddy site block:
```
dashboard.laughslapper.com {
	reverse_proxy app:3000
}
```
Caddy auto-provisions a separate Let's Encrypt cert for this second hostname. Express doesn't branch on hostname at all — `/calls/*` would work identically on either domain; `dashboard.laughslapper.com` is just the intended/documented one. Requires one more DNS A record (`dashboard` → the same VPS IP), same as `voiceagent` was added earlier.

## Deferred

- A full multi-call list/browse/search dashboard — this phase is deliberately just the single-call detail page.
- Real-time/automatic Lead→Job conversion tracking (the ST link always points at the Lead we create, never a Job).
