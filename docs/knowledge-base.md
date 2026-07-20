# Knowledge base

What the AI should know about a business: services, pricing, hours, service area, policies, common questions. **One library, used by both the voice agent and the [chat widget](chat-widget.md)**, edited in exactly one place (`/app/:businessId/settings/knowledge-base`).

## This app is the source of truth

It didn't start that way. The original version was a thin proxy over ElevenLabs' own Knowledge Base — documents were created *in* ElevenLabs and attached to the agent, and this app deliberately stored nothing ("ElevenLabs stays the sole source of truth", the same philosophy still used for Voices). That worked fine while the voice agent was the only consumer, and stopped working the moment the chat widget needed the same material.

The two consumers need different things:

- **ElevenLabs** needs documents *uploaded into their system*, and does its own retrieval internally during a call. You can't hand it text at question-time.
- **The chat widget (Claude)** needs the **raw text**, retrieved per question.

So the sync has to have a direction, and pulling *from* ElevenLabs is the wrong one: there's no content-retrieval endpoint in their API as used here, and a URL or PDF document only exists on their side as *their* parse of the original. Hence the flip: **this app owns the canonical text and pushes a copy to ElevenLabs.**

```
                    ┌──── this dashboard (source of truth) ────┐
add text / URL /    │  extract → REVIEW → knowledge_documents  │
file                │              │                │          │
                    │              │                └→ chunks + FTS5 index
                    │              └→ push as a text doc → ElevenLabs → voice agent
                    └──────────────────┬───────────────────────┘
                                       │  POST /knowledge/search
                                       ▼
                              chat widget service
```

Because the text is extracted here for every source type, **every push to ElevenLabs is a plain text document** — PDFs, URLs and typed text all follow one identical sync path, and their own file/URL ingestion endpoints are no longer used.

## Ingestion, and why extraction is reviewed

Three front doors, one pipeline:

| Source | How |
|---|---|
| **Text** | Typed or pasted straight in. |
| **URL** | Fetched with `axios`, then an in-house HTML-to-text pass (drops `script`/`style`/`nav`/`footer`, turns block tags into line breaks, decodes entities). |
| **File** | PDF via `pdf-parse`, DOCX via `mammoth`, plus TXT/MD/CSV passthrough. Reuses the existing `multer` memory-storage upload path. |

**Extraction is a separate step from saving.** `POST .../extract-url` and `.../extract-file` return plain text; nothing is stored until the operator reviews it in an editable box and saves. That's the design decision that keeps extraction from having to be perfect — page boilerplate or odd PDF layout gets cleaned by hand rather than by heuristics — and it means ingestion is one-shot at add-time rather than re-fetching a live page later.

Very long documents are trimmed at 150k characters with a warning, rather than silently indexing a book.

On save the text is split into ~1200-character chunks on paragraph boundaries (with ~150 characters of overlap, so a fact spanning a boundary is still retrievable from at least one chunk), written to `knowledge_chunks`, and indexed.

## Retrieval: SQLite FTS5, not embeddings

Retrieval is BM25-ranked full-text search using SQLite's built-in **FTS5** — verified available in the bundled SQLite of the Node version in use. No extra dependency, no external vendor, no per-query cost.

That's a deliberate choice rather than a shortcut, and it rests on one observation: **the model writes the query, not the visitor.** The widget's `search_knowledge_base` tool takes a query string, so Claude reformulates "my AC is blowing warm air" into terms matching the document's vocabulary before searching. That removes most of the paraphrase weakness usually cited for embeddings.

Two details found by testing, both of which matter more than they look:

- **`tokenize='porter unicode61'`.** The default tokenizer does no stemming, so "are you open on **sunday**" did not match a document saying "closed **Sundays**". Porter stems both to one root. Without it, natural phrasing fails against documents written in whatever tense the business happened to use.
- **A term-coverage filter on top of the OR'd query.** Terms are OR'd for recall, which alone gives poor precision: *"do you install solar panels"* matched a document merely saying "we **install** tankless units" — a junk hit that would mislead the assistant into thinking the KB covers solar. `bm25()` can't be thresholded to fix it, because with only a handful of documents IDF collapses and every score sits near zero. Instead, at least half the query's terms must actually appear in the chunk. Tuned to keep real matches: "are you open saturdays" (1 of 2) passes, "install solar panels" (1 of 3) doesn't.

Search is business-scoped in SQL, so one tenant's widget can never retrieve another tenant's knowledge.

The chunk table leaves room for an `embedding` column and hybrid ranking later — a pure backfill, no schema rewrite or re-ingestion, if quality ever demands it. (Anthropic has no embeddings API, so that means adding a vendor such as Voyage; deferred until there's evidence it's needed.)

## Storage — a deliberate exception to the encryption rule

Knowledge base content is stored **unencrypted**, unlike the PII and credentials everywhere else in this database ([sqlite-storage.md](sqlite-storage.md)).

FTS5 cannot index ciphertext: AES-GCM's random IV means the same text encrypts differently every time, so there is nothing stable to index. Searchable knowledge is the entire point of the table.

Judged acceptable because this holds *business reference material*, not customer PII or credentials — and the UI says so plainly ("don't put passwords, API keys, or customer details in here"). Worth stating explicitly since it's a real deviation, not an oversight.

## ElevenLabs sync

On save, the document's text is pushed as a text document and attached to the agent, with the returned id stored in `elevenlabs_document_id`. An edit is a *replace* (delete their copy, create fresh, re-attach) because their API has no confirmed in-place update. A delete detaches and removes both sides.

Two behaviours worth knowing:

- **It never blocks a save.** `syncDocumentToElevenLabs` returns a result rather than throwing. A business with no ElevenLabs credentials — a chat-only client, now a normal case — reports `not_configured`, and the document stays fully usable by the chat widget.
- **Drift is expected and repairable.** Editing the copy directly in the ElevenLabs dashboard puts it out of step with the truth here; the per-document **Resync** action overwrites theirs from ours. The UI is explicit that this app is where you edit.

## Why per-business scoping still holds

Knowledge Base documents in ElevenLabs' API are account-wide resources, with no `business_id` concept on their side. That was true of the original design and is still true of the pushed copies — but every business on this platform brings its **own** ElevenLabs account (own API key, own agent), so "account-wide" there is already business-scoped here, as long as every call uses that business's own stored credentials (`getElevenLabsConfig(businessId)`). Locally there's no ambiguity at all: `knowledge_documents` and `knowledge_chunks` both carry `business_id`, and every read is filtered by it.

## Access

Any user with access to the business can manage the library (`requireBusinessAccess`), not just platform admins — it's an ongoing content library staff maintain, not a credential. The ElevenLabs API key itself remains platform-admin-only in General Settings. Same reasoning as Voices; see [settings-app.md](settings-app.md).
