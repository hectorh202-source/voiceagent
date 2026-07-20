# AI website chat widget

An embeddable chat bubble that clients paste onto their own website. It engages the visitor, looks up their history in ServiceTitan, qualifies them, and either books a real appointment or forwards a lead into this dashboard's [Leads inbox](leads-inbox.md).

Unlike every other subsystem documented here, **the widget's code does not live in this repo** — it's a separate service in its own repo. This doc covers both halves, since the dashboard owns all of its configuration.

- **Widget service repo**: `https://github.com/hectorh202-source/chat-widget` (deployed at `chat.laughslapper.com`)
- **This repo's half**: the Chat Widget settings page, the config endpoint the service reads, and the Leads inbox rows it writes.

## Why it's a separate repo

The widget was first built *inside* this repo as an ordinary feature (in-process calls to the existing tool functions), which worked and was simpler. It was then deliberately split out at the operator's request, to get an independently deployable service.

Splitting it raised one real question: where does per-business config live? Two options were on the table — the service owning its own encrypted settings store + admin UI (full separation, but duplicating that entire stack and giving you two places to configure things), or keeping config here. **The hybrid was chosen**: config and secrets stay in this dashboard, and the service fetches them at runtime. That keeps one config surface and means all customer credentials continue to live in this app's encrypted store ([sqlite-storage.md](sqlite-storage.md)), never sprawling into a second database.

The practical consequence: the widget service is stateless apart from conversation history, and cannot function without this dashboard.

## Architecture

```
Client website (e.g. calltitanz.com)
  └─ <script> embed.js ──▶ iframe ──▶ chat-widget SERVICE
                                        (Claude engine, widget UI,
                                         chat_conversations SQLite)
                                            │
        per turn, the service calls THIS dashboard over HTTP:
          GET  /api/widget-service/businesses/:id/config   (X-Widget-Service-Secret)
          POST /b/:id/tools/{lookup-customer,check-availability,create-lead,book-job}
                                                            (X-Tool-Secret)
          POST /b/:id/webhooks/leads/inbound                (X-Lead-Intake-Secret)
                                            │
                                    THIS dashboard
                            (config, ServiceTitan, Leads inbox)
```

In production both run on the same VPS in the same Compose stack, so the service reaches the dashboard over the internal Docker network (`DASHBOARD_URL=http://app:3000`) — config, tool, and lead traffic never leaves the host. Only the `chat.` subdomain is exposed publicly, for client browsers.

### The integration contract

| Call | Auth | Purpose |
|---|---|---|
| `GET /api/widget-service/businesses/:id/config` | `X-Widget-Service-Secret` | Everything the service needs for one business: Anthropic key, model, branding, quick prompts, allowed origins, embed key, booking mode, timezone, the operator's Powered-by attribution — **plus the tool and lead-intake secrets** it uses for the calls below. |
| `POST /b/:id/tools/*` | `X-Tool-Secret` | The same four ServiceTitan tool webhooks the ElevenLabs voice agent uses ([elevenlabs-tools.md](elevenlabs-tools.md)). The widget reuses them rather than duplicating any ServiceTitan logic. |
| `POST /b/:id/webhooks/leads/inbound` | `X-Lead-Intake-Secret` | Drops the finished lead + full transcript into the Leads inbox. |

[`src/api/widgetServiceRouter.ts`](../src/api/widgetServiceRouter.ts) serves the config endpoint. It's mounted under `/api` but deliberately **outside** the session-auth `apiBusinessRouter` — it's service-to-service, authenticated by a shared secret rather than a browser session. It's a `GET`, which also means it passes the `/api` same-origin `verifyOrigin` guard (that only blocks state-changing cross-origin requests).

## Configuration

Split between global (the operator's, identical everywhere) and per-business:

| Scope | Keys | Where |
|---|---|---|
| **Global** (`settings`) | `widgetService.apiSecret`, `widgetService.baseUrl`, `widgetService.poweredByName`, `widgetService.poweredByUrl` | Global **Admin Settings → Chat Widget Service** |
| **Per-business** (`business_settings`) | `credentials.anthropicApiKey`, `chatWidget.enabled`, `chatWidget.model`, `chatWidget.embedKey`, `chatWidget.allowedOrigins`, `chatWidget.agentName`, `chatWidget.accentColor`, `chatWidget.greeting`, `chatWidget.logoUrl`, `chatWidget.tagline`, `chatWidget.quickPrompts`, `chatWidget.systemPromptExtras` | That business's **Settings → Chat Widget** |

Both follow the standard credential handling in [settings-app.md](settings-app.md): encrypted at rest, the Anthropic key never echoed back to the browser, blank-means-keep on save.

**The service itself holds only bootstrap config**, via environment variables — `DASHBOARD_URL`, `WIDGET_SERVICE_SECRET`, `PORT`, `DATABASE_PATH`, and optionally its own `ENCRYPTION_KEY` for conversations at rest. This is the one credential in the system that must exist outside this app's encrypted store, because a separate process needs *something* to authenticate its very first call. It's also why rotating that secret is the only rotation requiring an SSH trip rather than a form (see the confirm dialog on that button — rotating it takes every client's widget offline until the server's `.env` is updated and restarted).

**Two knowledge surfaces, for different jobs:**

- **`chatWidget.systemPromptExtras`** — free text appended to the system prompt on every message. Best for short, always-relevant instructions: tone, a catchphrase, "always mention the seasonal promo".
- **The shared [knowledge base](knowledge-base.md)** — documents (typed text, URLs, PDFs) retrieved on demand via the `search_knowledge_base` tool, and **shared with the voice agent**. This is where the substantive material goes: services, pricing, service area, policies, FAQ. It's retrieved per question rather than riding in every prompt, so it scales past what's sensible to inline.

## Security model

The widget runs in a stranger's browser on someone else's website, so its threat model is different from every other surface in this app.

- **The embed key is public by design.** It ships in the `<script>` snippet on client sites. It identifies the business and gives the operator a revocation lever (rotate it and every deployed snippet stops working), but it is *not* a secret and is deliberately shown in the clear in the UI.
- **The client-domain allowlist is enforced by CSP `frame-ancestors`**, not CORS. The chat UI is an iframe served from the *service's* origin, so its `/session` and `/message` calls are same-origin and CORS never enters the picture. What actually stops an arbitrary site from embedding the widget is the `frame-ancestors` directive on the app page, built from that business's allowed origins. The app route also has to *remove* the global `X-Frame-Options: DENY` for this to work.
- **A per-conversation bearer token** (HMAC, issued at `/session`, required on `/message`) binds a message stream to a conversation the service itself created. The load-bearing defence is the conversation id's own entropy (18 random bytes); the token stops a known id being replayed against another conversation.
- **Per-IP rate limiting** on `/session` and `/message` is the real abuse control, since the key is public.
- **Blast radius** of a leaked embed key: someone can open chats and drop leads into that one business's inbox, and burn Anthropic tokens. Same shape as the existing lead-intake secret, which is why the tradeoff was accepted.
- `img-src` allows `https:` on the app page specifically so a business can point `chatWidget.logoUrl` at an image hosted on their own site. Images only — scripts remain `'self'`.

## The conversation engine

Claude (Anthropic Messages API) via plain `axios`, matching this codebase's no-SDK convention. Adaptive thinking with `effort: low`, chosen because a website chat turn is latency-sensitive and interactive, not a long-horizon agentic task. Model is per-business (`claude-opus-4-8` default; Sonnet 5 / Haiku 4.5 selectable to cut cost on a high-traffic site).

`search_knowledge_base` queries the shared [knowledge base](knowledge-base.md) through a dedicated service-to-service endpoint, and the prompt requires it before answering anything about services, pricing, hours, coverage or policies — the failure mode being an assistant that answers from general knowledge about the trade instead of this business's actual documents. Its remaining four tools map one-to-one onto the dashboard's tool webhooks. **The booking guardrails are the same ones the voice agent relies on**, because both paths run through the same `runBookJobFlow` in [`src/tools/bookJob.ts`](../src/tools/bookJob.ts) (extracted for exactly this reason):

- Only books a slot that `check_availability` actually returned, after the visitor explicitly confirms it.
- Respects the business's `bookingMode` — in the default `lead` mode `book_job` isn't even offered to the model, so it structurally cannot book.
- Emergencies always fall back to a Lead, enforced in code rather than trusted to the prompt.

**Real ServiceTitan booking is in scope for the widget**, which is a deliberate exception to the "human confirms" rule that still governs the voice agent ([servicetitan-integration.md](servicetitan-integration.md)) — chosen explicitly by the operator as "book if confident, else forward a lead."

### Never losing a lead

Whatever happens, a conversation that reaches a lead/booking outcome writes an `inbound_leads` row — including when the ServiceTitan write itself fails (unconfigured, API down). Losing the visitor's contact details is the worse failure, the same philosophy as [`leadIntake.ts`](../src/webhooks/leadIntake.ts)'s fuzzy field matching.

Rows land with `source: "website_chat"`, `source_detail` of `booked` or `lead` (rendered as a badge in the inbox), the full readable transcript in `message`, and `externalId` set to the conversation id — so a re-post updates rather than duplicating, via the existing unique index.

## The widget UI

Server-generated HTML/CSS/JS strings rather than a bundled front-end app — the UI is small enough that a build step wasn't worth it, and it keeps the service a single deployable with no static asset pipeline.

- **`embed.ts`** generates the loader clients paste. It draws the launcher bubble in a **Shadow DOM** (so the host site's CSS can't touch it, or vice versa) and mounts the panel as an iframe. The iframe's `src` is set on **first open, not page load** — otherwise every page view would start a conversation server-side before anyone clicked.
- **`app.ts`** generates the chat UI: logo header, tagline, quick-prompt chips, avatars, timestamps, typing indicator, composer. The whole palette is derived from the business's single accent colour. All model output is rendered with `textContent`, never `innerHTML`, so a reply can't inject markup.
- **Quick prompts** are clickable starter chips; clicking one sends it as the first message and clears the set, so a visitor never faces an empty box.

### Writing style, and the em-dash rule

The assistant is instructed to write like a natural text conversation and never use em/en dashes. Because prompt instructions alone aren't reliable for this, `humanizeReply()` in the engine strips `—`/`–` from the visible reply as a hard guarantee. It only touches those two characters — ordinary hyphens in words and phone numbers use a different character and are left alone — and only the *outgoing* reply, never the stored transcript, which must stay byte-identical for the Anthropic message history to remain valid on the next turn.

## Deployment

Both apps run in **this repo's** `docker-compose.yml` behind the shared Caddy. The `widget` service builds from `../chat-widget`, so that repo must be cloned as a **sibling** of this one on the VPS (`~/voice-agent` and `~/chat-widget`). See [deployment.md](deployment.md) for the surrounding setup. Day-to-day:

```bash
cd ~/voice-agent && git pull
cd ~/chat-widget && git pull
cd ~/voice-agent && docker compose up -d --build
```

`WIDGET_SERVICE_SECRET` (and optionally `WIDGET_ENCRYPTION_KEY`) live in the same gitignored `.env` next to `docker-compose.yml` as `ENCRYPTION_KEY`.

### WordPress plugin

For WordPress clients, `wordpress-plugin/` in the widget repo is a thin loader: an admin settings screen (Business ID, Embed Key, widget service URL) and a `wp_footer` hook that prints the same `embed.js` script tag. It contains no widget logic at all, so it never needs updating when the widget changes. Distributed as a self-hosted `.zip` clients upload.

## Gotchas worth knowing

Each of these cost real debugging time:

- **`docker compose up -d --build` does not restart Caddy** if only the `Caddyfile` changed — the bind-mounted file isn't part of the container's config, so Compose reports `Container caddy-1 Running` and leaves it alone with its old config in memory. A new subdomain then has no certificate and fails with `ERR_SSL_PROTOCOL_ERROR`. Fix: `docker compose restart caddy`.
- **Windows PowerShell writes zip entries with backslashes.** Both `Compress-Archive` and .NET Framework's `ZipFile.CreateFromDirectory` do this, and WordPress (unzipping on Linux) then can't find the plugin file — "Plugin file does not exist." The plugin zip must be built with forward-slash entry names.
- **A naive colour shade function turns a saturated accent into neon.** Adding a flat amount per channel made `#0ea5e9` become `#83ffff`, unusable as a background tint. Mix toward white/black instead.
- **The router's error fallback bypasses `humanizeReply()`** — any hardcoded visitor-facing string has to be clean at the source, since only model output goes through the stripper.
- **`leadIntake.ts` dumps unrecognised body keys into the visible message.** When the widget started POSTing `source`/`sourceDetail`/`externalId` as body fields, they appeared in the lead's message text until those keys were added to `IGNORED_KEYS`.

## Deferred

- Streaming replies (the reply currently arrives in one piece after the tool loop finishes).
- Bot/spam hardening beyond rate limiting (e.g. hCaptcha).
- A per-business toggle to hide the operator's "Powered by" footer (white-label as an upsell).
- WordPress.org listing + auto-updates; the plugin is self-hosted only.
