# Architecture overview

This is the map of how all the pieces fit together. Read this first — the other docs in this folder each zoom into one box below.

## The systems involved

```
┌──────────┐      ┌────────────────────────────┐      ┌──────────────────────┐      ┌───────────────┐
│  Caller  │──────▶  Twilio phone number       │──────▶  ElevenLabs           │──────▶  This server  │
│ (phone)  │      │  (native ElevenLabs        │      │  Conversational AI    │      │  (VPS, Docker)│
└──────────┘      │   integration owns the     │      │  agent                │      └───────┬───────┘
                   │   voice webhook)           │      │  (STT + LLM + TTS)    │              │
                   └────────────────────────────┘      └───────────┬───────────┘              │
                                                                     │ tool-call webhooks       │
                                                                     │ (JSON over HTTPS)         │
                                                                     └──────────────────────────▶│
                                                                                                  ▼
                                                                                      ┌───────────────────┐
                                                                                      │  ServiceTitan API │
                                                                                      │  (CRM + Dispatch) │
                                                                                      └───────────────────┘
```

Four systems, three of which are entirely outside this codebase:

| System | What it does | Who owns/configures it |
|---|---|---|
| **Twilio** | Owns the phone number, routes the call | Your Twilio account, but ElevenLabs configures its webhook automatically once you import the number |
| **ElevenLabs Conversational AI** | Speech-to-text, the LLM conversation itself, text-to-speech, turn-taking, and the emergency call-transfer feature | ElevenLabs dashboard (agent config, system prompt, tools, phone numbers) — see [elevenlabs-tools.md](elevenlabs-tools.md) |
| **This server** (this repo) | Exposes 3 webhook "tools" the agent calls mid-conversation; talks to ServiceTitan; stores credentials/logs — for potentially many businesses at once, each fully isolated | This codebase, deployed via Docker — see [deployment.md](deployment.md) |
| **ServiceTitan** | The actual CRM: customer records, leads, technician capacity | Each business's own ServiceTitan tenant (sandbox or production) — see [servicetitan-integration.md](servicetitan-integration.md) |

**The most important thing to understand**: this server never touches call audio, Twilio, or the conversation itself. It only receives clean JSON requests from ElevenLabs at specific moments the agent decides to use a "tool" — e.g. "let me look up this caller" or "let me file this as a lead." Everything about *how the call sounds and flows* lives in ElevenLabs' agent configuration, not in this code.

**This is a multi-business platform, not a single-tenant app**: every business gets its own ElevenLabs agent, ServiceTitan tenant, and set of credentials, all identified by a `businessId` in the URL path (`/b/:businessId/...`). One shared login pool (platform users, see [settings-app.md](settings-app.md)) can manage every business from a single dashboard — there's no per-business login.

## Request flow: a typical call

```
1. Caller dials the Twilio number
2. Twilio hands the call to ElevenLabs (native integration, no code involved)
3. ElevenLabs agent greets the caller, and — per the system prompt — silently calls
   the `lookup_customer` tool using the caller's phone number
     → POST https://<your-domain>/b/:businessId/tools/lookup-customer
     → this server resolves :businessId, calls that business's ServiceTitan Customers API
     → returns { found, customerId, name, address }
4. Agent continues the conversation (using that result to skip re-asking for name/address)
5. If the caller describes an emergency, the agent uses its built-in "transfer to
   number" system tool — this is 100% ElevenLabs-side, no webhook call to this server
6. Otherwise, once the agent has the issue/timing, it calls `create_lead`
     → POST https://<your-domain>/b/:businessId/tools/create-lead
     → this server finds-or-creates the ServiceTitan customer, then creates a Lead
     → returns { success, leadId, confirmationMessage }
7. Agent closes the call, telling the caller a team member will confirm
8. Every tool call (steps 3 and 6) is logged to the local `call_log` table,
   tagged with that business's ID, regardless of success/failure — see sqlite-storage.md
```

## Request flow: configuring the server

```
1. Admin visits https://<your-domain>/settings
2. First visit ever → prompted to create the first platform account (email + password)
3. Every visit after → login form (email + password), session cookie issued and persisted to SQLite
4. Once logged in: a list of businesses (+ an "Add business" form, + Users
   management for the shared login pool) — not a credentials form directly
5. Clicking a business goes to /b/:businessId/settings: that ONE business's
   ElevenLabs / ServiceTitan / Operational credentials, each field saved
   independently and encrypted at rest, scoped to that business only
```
See [settings-app.md](settings-app.md) for the full breakdown and [sqlite-storage.md](sqlite-storage.md) for the storage mechanics underneath it.

## Code layout

```
src/
  index.ts              # entrypoint — wires up express, sessions, mounts every router
  config/env.ts         # non-secret infra config only (PORT, DATABASE_PATH)
  db/                    # SQLite connection, schema, businesses.ts, call-log helpers
  settings/              # encrypted settings store (global + per-business), admin auth,
                          # session store, the global /settings app, businessRoutes.ts
                          # (the per-business credentials form)
  servicetitan/          # OAuth token caching + API client (customers, leads, capacity) —
                          # every function takes a businessId
  tools/                 # the 3 Express routes ElevenLabs calls as webhook tools
  middleware/            # request logging, tool-secret auth, admin-session auth,
                          # resolveBusiness (resolves :businessId → a real business or 404s)
```

Routers mounted in `index.ts`:
- `/settings/*` — global: login/setup/migrate, the business list, and platform user management. Protected by admin login (see [settings-app.md](settings-app.md)).
- `/b/:businessId/*` — everything scoped to one business: `/settings` (that business's credentials form), `/tools/*` (ElevenLabs webhook tools, protected by a per-business shared-secret header), `/webhooks/*` (the post-call webhook), and `/calls/:conversationId` (the public call-detail page). `resolveBusiness` runs first for all of these and 404s immediately on an invalid/nonexistent business ID.

## Deployment topology

```
Your VPS
├── game server (unrelated, coexists fine — different ports)
└── Docker
    ├── "app" container   — this server, port 3000 (NOT exposed to the host/internet directly)
    └── "caddy" container — reverse proxy, ports 80/443 (the only ports exposed)
         └── auto-provisions a Let's Encrypt HTTPS cert for your domain
              └── forwards everything to the app container over the internal Docker network
```
Full details, including why Docker (not a native VPS install) and why Caddy specifically, in [deployment.md](deployment.md).

## Design decisions worth knowing up front

- **Leads, not live bookings**: the agent never writes directly to the ServiceTitan schedule. It creates a Lead for a human to confirm. This was a deliberate risk-reduction choice for the MVP.
- **No credentials in code or `.env`**: every credential is entered through the `/settings` web UI and stored encrypted in SQLite — never in source control, never in an env file. See [sqlite-storage.md](sqlite-storage.md).
- **ServiceTitan integration/sandbox vs. production environment is a per-business choice** — each business picks its own via a dropdown on its own `/b/:businessId/settings` page, independent of any other business's choice.
- **Single process, no queue, no ORM**: this is intentionally a small monolith. There's no reason to split it into microservices at this scale.
