# Technical docs

Deeper write-ups on specific subsystems, for anyone picking up this project who wants to understand how (and why) something was built the way it was — not just what the code does. Start with the overview, then read whichever chapter matches what you're touching.

## Start here

- **[Architecture overview](architecture-overview.md)** — the big picture: how Twilio, ElevenLabs, this server, and ServiceTitan fit together, end-to-end request flows, code layout, and the deployment topology.

## Core systems (this codebase)

- **[SQLite storage system](sqlite-storage.md)** — the single local database: encrypted credential storage, per-user password hashing, call/tool logging, and persisted web sessions.
- **[The `/settings` app](settings-app.md)** — the credentials web UI built on top of that storage: routes, multi-user login/brute-force protection, and how per-field saves work (and the bug that shaped that design).
- **[Per-call record page](call-dashboard.md)** — `dashboard.laughslapper.com/calls/:id`: ingesting ElevenLabs' post-call webhooks (transcript, recording, summary), correlating them with our own `create_lead` data, and the signature verification scheme.

## Integrations (external systems this talks to)

- **[ServiceTitan integration](servicetitan-integration.md)** — OAuth token handling, customer lookup/creation, lead creation, capacity checks, and why this deliberately never books live appointments.
- **[ElevenLabs tools & agent configuration](elevenlabs-tools.md)** — the three webhook tools this server exposes, the tool-auth header scheme, and a reference for how the ElevenLabs-side agent (system prompt, transfer rule, tool definitions) is configured — since that half lives outside this repo entirely.

## Operations

- **[Deployment](deployment.md)** — Docker/Caddy/VPS setup: why Docker, the two-container topology, volumes and what's at stake if they're lost, DNS, firewall, and day-to-day operational commands.

---

Add new docs here as the project grows and link them into the right section above. If a doc's scope changes enough that it no longer fits its section, move it — this index should always reflect what's actually true, not just append forever.
