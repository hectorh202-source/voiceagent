# Leads inbox

A unified inbox — `https://<your-domain>/app/:businessId/leads` — aggregating a business's raw inbound leads from every one of its own lead sources (website contact forms, website chat widgets, and eventually Facebook Lead Ads / Google Ads lead forms) into one place, with a manual triage pipeline (status stages, read/unread, internal notes).

Scoped to one business at a time, same as every other section of this app — see [architecture-overview.md](architecture-overview.md) for the platform's multi-business model.

## Not a ServiceTitan Lead

**"Lead" already means a ServiceTitan CRM Lead everywhere else in this codebase** (`servicetitan/leads.ts`, `tools/createLead.ts` — the object the AI phone agent creates via `create_lead`). This is a deliberately distinct concept — a raw, unqualified inbound inquiry from an ad or a website form — and every identifier in the DB/API/client uses `inbound_leads`/`InboundLead*`, never bare "Lead," to keep the two unambiguous. (The nav label and page title are still just "Leads" — that's the user-facing term.)

**Dashboard-only, by design**: a lead landing here never automatically creates a ServiceTitan Lead/Job. This is explicitly a triage inbox, not a booking pipeline — staff decide manually, later, whether a given inbound lead is worth pursuing in ServiceTitan at all.

## Schema — `inbound_leads`

```sql
CREATE TABLE inbound_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  source TEXT NOT NULL,
  external_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT,
  phone TEXT,
  email TEXT,
  message TEXT,
  raw_payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  is_read INTEGER NOT NULL DEFAULT 0,
  internal_notes TEXT
);
```

`source` (`website_form` | `website_chat` | `facebook_ads` | `google_ads`) and `status` (`new` | `contacted` | `qualified` | `won` | `lost`) are plain unconstrained `TEXT`, validated only at the Zod layer (`src/api/schemas.ts`'s `LEAD_SOURCE_VALUES`/`LEAD_STATUS_VALUES`) — same reasoning as `elevenlabs_calls.call_reason`/`status_override` elsewhere: a new value never needs a migration. Unlike Calls' Bookability, there's no auto-derived value to override here — every lead just starts at `new` and is progressed manually, so `status` is a single plain column, not an override/auto pair.

`name`/`phone`/`email`/`message`/`internal_notes` are encrypted at rest (`encryptNullable`/`decryptNullable`, same as equivalent PII fields on `call_log`/`elevenlabs_calls`); `raw_payload_json` (`NOT NULL`, the full original webhook body) is encrypted via `encryptField`/`decryptField` — kept for audit, same reasoning as `elevenlabs_calls.raw_payload_json`, and never returned by the API (`GET /leads/:id` excludes it, same as `GET /calls/:conversationId` excluding its own `raw_payload_json`). All of this lives in `src/db/inboundLeads.ts`, structured 1:1 with `src/db/callRecords.ts`.

**Dedup**: `external_id` plus a partial unique index (`(business_id, source, external_id) WHERE external_id IS NOT NULL`) guards against a source that redelivers the same submission — relevant for Facebook/Google webhooks (not built yet), irrelevant for today's website-form/chat submissions, which have no natural retry and no `external_id`, so every one of those is simply its own row. `insertInboundLead()` uses `ON CONFLICT ... DO NOTHING` when `external_id` is present, so a genuine re-delivery never creates a duplicate row or clobbers anything a human has already triaged.

## The generic webhook — website forms + chat

The only source with real ingestion built so far. A business's website contact form or chat widget — whatever tool that happens to be, since this deliberately doesn't integrate with any specific vendor — POSTs directly to:

```
POST /b/:businessId/webhooks/leads/inbound
Header: X-Lead-Intake-Secret: <secret from that business's General Settings>
Body:   { "source": "website_form" | "website_chat", "name"?, "phone"?, "email"?, "message"?, "externalId"? }
```

At least one of `name`/`phone`/`email` is required; everything else optional. The body can be JSON **or** `application/x-www-form-urlencoded` — both already work, since `express.urlencoded()` is mounted globally alongside `express.json()` (confirmed via a real test POST of each shape), which matters because not every form tool sends JSON.

**Success responds `200`, not the more conventional `201` for a created resource** — confirmed necessary, not stylistic: Elementor Pro Forms' Webhook action only treats a literal `200` as success and throws a "Webhook Error" for anything else (`201`, `204`, etc. all fail it — a real, documented Elementor limitation, not a guess). Since this endpoint's whole purpose is compatibility with whatever third-party tool a business already uses, matching what those tools actually expect wins over REST convention here.

Auth is a **plain shared secret** (not HMAC) via `src/middleware/verifyLeadIntakeSecret.ts` — byte-for-byte the same shape as the existing ElevenLabs tool webhooks' `verifyToolSecret.ts` (`crypto.timingSafeEqual` after a length check, `503` if unset, `401` if missing/wrong), chosen over a signing scheme because this endpoint is meant to be pasted into whatever simple form-builder or chat tool a business already uses, not a platform with its own HMAC contract like ElevenLabs or Twilio.

**The secret can also ride in the URL as a `?secret=` query param instead of the header** — confirmed necessary, not just theoretical: **Elementor Pro Forms' "Webhook" action only accepts a plain URL, with no way to attach a custom header at all.** `verifyLeadIntakeSecret` checks the header first, falling back to `req.query.secret`. This is a deliberate tradeoff (a query string can end up in server access logs or browser history more easily than a header) accepted because the alternative is not supporting tools like Elementor at all — and a leaked lead-intake secret only lets someone submit fake rows into this one inbox, not a credential with any broader reach.

**Every client's form is labeled differently, and there's no universal fixed field name to rely on** — confirmed against a real Elementor Pro Forms submission, which keys each field by its own **label**, not a fixed ID:
```json
{"First Name":"Test","Last Name":"User","Phone":"9415556254","Email":"test@test.com","Message":"Test message", ...}
```
No `source` field at all (Elementor's Webhook action has no way to add one), `"Phone"`/`"Email"`/`"Message"` capitalized, a split `"First Name"`/`"Last Name"` instead of one `name`, plus assorted other fields (`"Address"`, `"Date"`, `"form_id"`, etc.) that aren't part of this app's schema at all. Renaming a business's own user-facing form field labels to match this endpoint's contract exactly isn't a reasonable ask of every client — so `handleLeadIntake` (`src/webhooks/leadIntake.ts`) takes a **best-effort, never-reject** approach instead of requiring an exact shape:

- `source` defaults to `"website_form"` when absent (Elementor can never send one).
- `name`/`phone`/`email`/`message` are matched by **substring, case-insensitively** (`FIELD_SUBSTRINGS`) rather than an exact key — e.g. any key containing `"phone"`/`"mobile"`/`"cell"` resolves to `phone`, anything containing `"mail"` resolves to `email`. Deliberately broad: a false-positive match just means a field lands somewhere slightly odd, whereas a missed match means losing a lead's contact info outright — the worse failure mode by far.
- `"First Name"` + `"Last Name"` combine into a single `name` when there's no direct `name`-like field. Elementor's own fixed system fields (`form_id`, `form_name`) are explicitly ignored so `"form_name"` never false-matches the `"name"` substring and overwrites the lead's actual name with the form's own title.
- **If nothing looks like a "message" field, every remaining unclaimed field becomes the message instead of being silently dropped** — formatted as `Key: Value` lines, so a business's own staff can read exactly what an unrecognized form submitted directly in the inbox, with zero setup, rather than someone needing a database script to dig through `raw_payload_json`. Confirmed against three real shapes: a form matching cleanly (stays clean, no dump), a form matching nothing at all (the entire body becomes the message), and a form matching some fields but not others (matched fields go to their own column, everything else falls into the dump).
- **Nothing is ever rejected for missing fields** — `leadIntakeSchema` has no required fields beyond `source` (which always gets defaulted) and no format validation on `email`. A submission that matches none of this app's expected shape still gets stored, with whatever was found (which, worst case, is the entire raw body as `message`) — losing a real customer's inquiry because a business's form doesn't match this app's conventions is worse than an imperfectly-mapped one.

The substring list is deliberately small and only contains what's been confirmed necessary — not a guess at every label some future form might use. Extend `FIELD_SUBSTRINGS` if a new tool's fields consistently land in the wrong place, verified the same way this one was: submit a real test lead, check the stored row's `name`/`phone`/`email`/`message` (or the validation-failure log line, `Lead intake validation failed. Raw body: ...`, kept in as a safety net even though the schema no longer has any way to actually fail it), and adjust.

The secret lives at `operational.leadIntakeWebhookSecret` (business-scoped, encrypted), configured/generated on that business's own General Settings page — same "leave blank to keep," "Generate a new secret" pattern as the existing tool/post-call webhook secrets there.

## API — `src/api/businessRouter.ts`

- `GET /leads` — keyset-paginated (same cursor pattern as `GET /calls`, just a `{receivedAt, id: number}` pair since lead ids are numeric), filterable by `source`/`status`/`isRead`/`from`/`to`.
- `PATCH /leads` — `{ ids: number[], isRead?, status?, internalNotes? }`, bulk-updates via `updateInboundLead()`.
- `GET /leads/:id` — detail view. Includes `rawDump`, a plain "Key: Value"-per-line rendering of the *entire* stored `raw_payload_json` (`src/lib/format.ts`'s `formatKeyValueDump()`) — a deliberate exception to how `GET /calls/:conversationId` handles its own `raw_payload_json` (never exposed there, internal/audit only). For Leads it's shown **always, for every lead, regardless of how cleanly name/phone/email/message matched** — since every client's form is labeled differently, staff need a way to see exactly what was actually submitted even when this app's field-matching got some or all of it wrong. Rendered in `LeadDetailPage.tsx` under "Raw Submission Data," always the last section on the page.

## Client

`client/src/pages/LeadsListPage.tsx` mirrors `CallsListPage.tsx` exactly (URL-synced filters, `useInfiniteQuery` keyset pagination, bulk-select + bulk actions, an "Export CSV" button that drains every remaining page first) via its own small parallel components (`LeadsTable`/`LeadsFiltersPanel`/`LeadsBulkActionBar`) rather than generalizing the Calls-specific ones, which are hardcoded to Calls' exact fields with no generic prop surface. `client/src/pages/LeadDetailPage.tsx` mirrors `CallDetailPage.tsx`'s status-dropdown + three-state Internal Notes editor (no-note / editing / saved).

**Opens as a modal over the list, same as Calls** — `LeadsTable.tsx`'s row click passes `{ state: { backgroundLocation: location } }` (the standard react-router "modal route" pattern, identical to `CallsTable.tsx`), `LeadDetailPage.tsx` checks `location.state` for it and wraps its content in `.modal-overlay`/`.modal-large` when present, and `App.tsx`'s `AuthenticatedRoutes` renders `leads/:leadId` in both the background `<Routes>` tree and the overlay `<Routes>` tree, exactly matching `calls/:conversationId`'s setup. A direct navigation/refresh/bookmark to a lead's URL still carries no such state, so it falls back to rendering as a normal full page in that case — the modal is purely an enhancement for the navigate-from-the-list case, never the only way to reach a lead.

## Deferred — Facebook Lead Ads and Google Ads

Both are real, separate integrations, not designed in detail here — the schema already accommodates either as a future `source` value with zero migration needed:

- **Facebook Lead Ads** — needs a Facebook App + Page connection per business, a `leadgen` webhook subscription, and a long-lived Page access token stored per business, plus Facebook App Review before it can run for real businesses.
- **Google Ads leads** — needs an OAuth client + per-business refresh token, then either a Lead Form Extension webhook (Google-side push, requires linking the form) or polling the Google Ads API for form submissions.

Whenever either gets built, it writes to `inbound_leads` via `insertInboundLead()` directly (`source: "facebook_ads"`/`"google_ads"`), not through the generic `/webhooks/leads/inbound` endpoint above, which deliberately only accepts `website_form`/`website_chat`.

## Verified

A scratch round-trip against the real dev DB (insert → confirmed encrypted at rest, differing from plaintext → list/get/patch all correct → cleaned up), and the full webhook auth/validation matrix via real HTTP requests against a running dev server: missing header → `401`, wrong secret (header and query-param forms both) → `401`, unset secret → `503`, valid request via header → `201`, valid request via `?secret=` query param → `201`, valid request with a form-urlencoded body via `?secret=` → `201` (all three confirmed to actually land in the DB via a direct read, then cleaned up), missing name/phone/email → `400`, and a `source` outside `website_form`/`website_chat` (e.g. `facebook_ads`) correctly rejected by this endpoint → `400`.
