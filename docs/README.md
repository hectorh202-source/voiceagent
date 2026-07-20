# Technical docs

Deeper write-ups on specific subsystems, for anyone picking up this project who wants to understand how (and why) something was built the way it was — not just what the code does. Start with the overview, then read whichever chapter matches what you're touching.

## Start here

- **[Architecture overview](architecture-overview.md)** — the big picture: how Twilio, ElevenLabs, this server, and ServiceTitan fit together, end-to-end request flows, code layout, and the deployment topology.

## Core systems (this codebase)

- **[SQLite storage system](sqlite-storage.md)** — the single local database: encrypted credential storage, per-user password hashing, call/tool logging, and persisted web sessions.
- **[The `/settings` app](settings-app.md)** — global auth (multi-user login/brute-force protection) and the two per-business settings pages (Business Info, General) in the React admin dashboard (`client/`), talking to a JSON API instead of posting an HTML form.
- **[Per-call record page & Calls dashboard](call-dashboard.md)** — the public, unauthenticated per-call page (`dashboard.laughslapper.com/b/:id/calls/:conversationId`: transcript, recording, summary, ServiceTitan link) plus the login-gated Calls/Call Metrics sections of the React admin dashboard (`/app/:businessId/calls`), including the Booked/Not Booked/Excused status, read/recovered tracking, Call Reason tagging, and [human-portion call recording for transferred calls](call-dashboard.md#human-portion-recording-transferred-calls) (a single master Twilio account, a poller instead of a webhook, and a real outage worth reading about before touching Twilio Console again).
- **[Leads inbox](leads-inbox.md)** — a unified per-business inbox (`/app/:businessId/leads`) aggregating raw inbound leads from website forms/chat today (a generic shared-secret webhook), with Facebook Lead Ads/Google Ads leads deferred — deliberately distinct from a ServiceTitan Lead, dashboard-only, never auto-pushed anywhere.
- **[Google Local Services Ads (LSA) leads](google-lsa-leads.md)** — the third Leads inbox source, a polling integration against Google's Ads API (a Manager-account Developer Token, OAuth Client ID/Secret, per-business refresh tokens), live and verified against TitanZ's real account.
- **[AI website chat widget](chat-widget.md)** — an embeddable chat bubble clients paste on their own site (Claude-powered), which qualifies visitors and books a job or forwards a lead into the Leads inbox. **Lives in its own repo** and runs as a separate service; this dashboard owns its configuration and receives its leads. Covers the two-repo split, the integration contract, the security model, and deployment.
- **[Per-business Knowledge Base](knowledge-base.md)** — a management UI (`/app/:businessId/settings/knowledge-base`) over ElevenLabs' own native Knowledge Base feature, letting each business upload/attach reference documents (text/URL/file) to its agent.
- **[Dynamic memory](dynamic-memory.md)** — opt-in cross-call memory by phone number: a returning caller's agent gets a short summary of their last call, delivered by piggybacking on the existing `lookup_customer` tool call.

## Integrations (external systems this talks to)

- **[ServiceTitan integration](servicetitan-integration.md)** — OAuth token handling, customer lookup/creation, lead creation, capacity checks, and why this deliberately never books live appointments.
- **[ElevenLabs tools & agent configuration](elevenlabs-tools.md)** — the three webhook tools this server exposes, the tool-auth header scheme, and a reference for how the ElevenLabs-side agent (system prompt, transfer rule, tool definitions) is configured — since that half lives outside this repo entirely.

## Operations

- **[Deployment](deployment.md)** — Docker/Caddy/VPS setup: why Docker, the two-container topology, volumes and what's at stake if they're lost, DNS, firewall, and day-to-day operational commands.

## Planning

- **[Roadmap](roadmap.md)** — deferred work: near-term items (write-time call flags, real pagination, the Emergency Dispatch fix), security hardening not yet done, and other things discussed but not yet built.

---

Add new docs here as the project grows and link them into the right section above. If a doc's scope changes enough that it no longer fits its section, move it — this index should always reflect what's actually true, not just append forever.
