# Per-business Knowledge Base

A per-business library of reference documents the AI phone agent can draw on during calls — pricing sheets, service-area pages, FAQs. This does **not** build a competing document store or in-house RAG pipeline: it's a thin management UI (`/app/:businessId/settings/knowledge-base`) over ElevenLabs' own native [Knowledge Base](https://elevenlabs.io/docs/api-reference/knowledge-base) feature, the same "ElevenLabs stays the sole source of truth" philosophy already used for [Voices](settings-app.md).

**Status: live and verified end-to-end against TitanZ's real ElevenLabs account (2026-07-17).** All three creation paths (text/URL/file), attach/detach, delete (with the dependent-agents warning), and the array-merge PATCH behavior are confirmed against a real agent.

## Why this is "per-business" even though ElevenLabs' API is account-wide

Knowledge Base documents in ElevenLabs' API are account-wide resources — created independent of any agent, then attached to one (or more) agents by editing that agent's own `conversation_config.agent.prompt.knowledge_base` array. There's no `business_id` concept on ElevenLabs' side at all. But every business on this platform already brings its own **separate** ElevenLabs account (own API key, own agent) — so "account-wide" from ElevenLabs' perspective is already fully business-scoped from this platform's perspective, as long as every call uses that business's own stored credentials (`getElevenLabsConfig(businessId)`, same as every other ElevenLabs call in this codebase). No cross-business leakage is possible without a credential mix-up, which would be a bug in `settings/store.ts`, not in this feature.

## UI placement — own top-level nav item, not a settings card

Direct precedent: **Voices** already gets its own top-level nav group and its own route (`/app/:businessId/settings/voices`), gated only by `requireBusinessAccess` (not the platform-admin-only gate General Settings uses) — confirmed by reading `businessRouter.ts` directly: `apiBusinessRouter.use(requireBusinessAccess)` applies router-wide, and `/settings/voice*` has no additional `requireApiPlatformAdmin`. Knowledge Base fits this pattern even better than Voices — an ongoing, growing content library non-admin staff would plausibly manage regularly, not a rarely-touched config field. Built the same way: its own nav group, its own route, `requireBusinessAccess`-only API gating. The ElevenLabs API key itself stays platform-admin-only, entered via General Settings — this page only manages documents on top of an already-configured account.

## API surface — `src/elevenlabs/knowledgeBase.ts`

| Action | Endpoint |
|---|---|
| List | `GET /v1/convai/knowledge-base` — paginated (`page_size`, `search`, `cursor`) |
| Create from text | `POST /v1/convai/knowledge-base/text` |
| Create from URL | `POST /v1/convai/knowledge-base/url` |
| Create from file | `POST /v1/convai/knowledge-base/file` — multipart |
| Dependent agents | `GET /v1/convai/knowledge-base/{id}/dependent-agents` |
| Delete | `DELETE /v1/convai/knowledge-base/{id}` (`force` to skip the dependent-agents check) |
| Attach/detach | read-modify-write PATCH of the agent's own `conversation_config.agent.prompt.knowledge_base` array |

Every call follows the same `elRequest`/`requireElevenLabsConfig` pattern already used in `agents.ts`/`voices.ts` — except file upload, which bypasses `elRequest` entirely (built for JSON/arraybuffer, not multipart) in favor of native `FormData`/`Blob` so axios can set the multipart boundary automatically.

Zero local caching of document content — same precedent as Voices. `multer.memoryStorage()` is used only to receive the *inbound* upload from the browser; nothing is written to disk, and nothing is stored in this app's own database beyond what's already true for every other ElevenLabs-backed feature (nothing).

## Real bugs found and fixed against live data (2026-07-17)

- **File upload sent an empty Content-Type, rejected even for otherwise-allowed extensions.** `createFileDocument()`'s original code built the multipart part as `new Blob([params.buffer])` — no MIME type — which Node's `Blob` defaults to an empty string. ElevenLabs validates the uploaded part's Content-Type against an allowlist (`application/pdf`, `.docx`, `.epub`, `text/plain`, `text/html`, `text/markdown`) and **rejects an empty/missing Content-Type outright**, even though `text/plain` itself is on the allowlist — the real response: `{"detail":{"message":"Invalid file type. Allowed types are [...]", "status":"invalid_file_type"}}`. Fixed by threading the real upload MIME type through: `req.file.mimetype` (multer's read of the browser's own `File.type`) → `createFileDocument({ ..., mimeType })` → `new Blob([buffer], { type: mimeType })`. Confirmed fixed by re-uploading the same `.txt` file and getting a real `200` with correct metadata back.

## What was confirmed, not assumed, against the real account

- The array-merge PATCH behavior for `.agent.prompt.knowledge_base` — attaching a document does **not** clobber unrelated `conversation_config` fields (`tts.voice_id`, `name` were independently re-checked via a direct GET after the PATCH and were untouched), and detaching correctly leaves the array with just the remaining entries.
- The dependent-agents delete-confirmation path — deleting a document that's still attached to an agent surfaces a real warning before letting the delete through with `force=1`.
- All three document-creation paths (text, URL, file) and the full attach → detach → delete lifecycle, tested against TitanZ's real account and cleaned up afterward (no test documents left behind).

## What's still unconfirmed

- Behavior for `.pdf`/`.docx`/`.epub` uploads specifically — only `.txt` was tested for real. The Content-Type fix above should generalize (multer already reads the real MIME type off the browser's `File` object for any file type), but hasn't been separately re-verified for those formats.
- Folder-type documents (`type: "folder"`) — the schema/types account for the enum value, but no folder was created or attached during verification; ElevenLabs' folder semantics (bulk-attach implications, etc.) are unexplored.
