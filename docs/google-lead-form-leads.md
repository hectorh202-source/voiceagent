# Google Ads Lead Form Extension leads

A *different* Google product from [Google Local Services Ads](google-lsa-leads.md) — a lead-gen form attached to a regular Search/Display/Performance Max ad (or a conversational ad experience), not the Local Services Ads product. This is the fourth source feeding the [Leads inbox](leads-inbox.md), source value `google_ads`.

**Status: built and verified against a simulated real payload (2026-07-21).** Unlike LSA, this needed no OAuth client, no Developer Token, no Manager account — Google's own documented integration path for this product is a real webhook, not a poller.

## Why this is a webhook, not a poller like LSA

LSA has no true webhook at all — Google's Local Services Ads API is poll-only, which is why `google-lsa-leads.md`'s integration is a 5-minute `setInterval` loop against a GAQL query. Lead Form Extensions are different: Google's own "Export leads" flow in the Google Ads UI has a documented "Webhook integration" option that POSTs each lead to a URL you configure, in real time, the moment someone submits the form. There is also a GAQL-pollable `lead_form_submission_data` resource, but the webhook is Google's own recommended integration path for exactly this use case, and it avoids reusing/depending on the heavier Google Ads OAuth/Developer Token/Manager-account infrastructure LSA needed — so this was built as a webhook.

## Real payload shape (confirmed against Google's documentation, 2026-07-21)

A flat `WebhookLead` JSON object:

```json
{
  "lead_id": "...",
  "api_version": "...",
  "form_id": 123,
  "campaign_id": 456,
  "adgroup_id": 789,
  "gcl_id": "...",
  "google_key": "...",
  "is_test": false,
  "lead_submit_time": "2026-07-21T10:00:00Z",
  "lead_source": "LEAD_FORM",
  "user_column_data": [
    { "column_id": "FULL_NAME", "column_name": "Full name", "string_value": "Jane Doe" },
    { "column_id": "PHONE_NUMBER", "column_name": "Phone number", "string_value": "+11234567890" },
    { "column_id": "EMAIL", "column_name": "Email", "string_value": "jane@example.com" }
  ]
}
```

`lead_source` is `"LEAD_FORM"` (a form on a regular ad) or `"CONVERSATIONAL_AGENT"` (a chat-style ad experience) — both delivered through the same webhook, stored as `sourceDetail`. `user_column_data` is one entry per form question; `column_id` is Google's fairly stable field-type identifier (`FULL_NAME`, `FIRST_NAME`/`LAST_NAME`, `EMAIL`, `PHONE_NUMBER`, plus form-specific custom question types). PII arrives as plain, unencrypted `string_value` — no hashing or redaction at the webhook level.

Google's own documented response contract (followed exactly in `src/webhooks/googleLeadForm.ts`, since Google's own delivery system parses these, not this app's usual `{error}`/`{success}` shapes):
- `200` with `{}` body — accepted.
- `4xx` with `{"message": "..."}` — non-retryable (Google won't resend).
- `5xx` with `{"message": "..."}` — retryable (Google will resend).

Delivery also isn't guaranteed exactly-once ("A single lead is not guaranteed to be delivered exactly once" — Google's own docs), so this relies on the same `ON CONFLICT ... DO UPDATE` upsert `insertInboundLead()` already uses for LSA's polling, keyed on `lead_id` as `external_id`.

## Auth — a `google_key` in the body, not a header or query param

Every other webhook secret in this app (the generic lead-intake webhook, ElevenLabs' post-call signing secret) is checked via a header or query param. Google's lead form webhook is different: the shared secret ("Webhook key," configured once in the Google Ads UI alongside the webhook URL) rides inside the JSON body as `google_key`. `handleGoogleLeadFormWebhook` checks it directly (`crypto.timingSafeEqual`, same constant-time pattern as every other secret check here) rather than reusing `verifyLeadIntakeSecret` middleware, both because the secret's location differs and because Google's required error response shape (`{"message": ...}`) doesn't match that middleware's `{"error": ...}` shape.

Stored per business at `operational.googleLeadFormWebhookSecret` (mirrors `operational.leadIntakeWebhookSecret` exactly — same "leave blank to keep," same generate-a-new-secret-with-a-confirm-dialog UI in General Settings' Operational card), since each business's own Google Ads account configures its own webhook independently.

## Field mapping

`buildLeadFields()` in `src/webhooks/googleLeadForm.ts` matches `user_column_data` entries by `column_id` first (`FULL_NAME`/`FIRST_NAME`+`LAST_NAME` combined → `name`, `PHONE_NUMBER` → `phone`, `EMAIL` → `email`), falling back to a substring match on any unrecognized `column_id` containing `NAME`/`PHONE`/`EMAIL` — the same "recall over precision" reasoning `leadIntake.ts`'s own field matching already uses, since losing a lead's contact info outright is worse than an occasional odd placement. Everything else (custom form questions) is appended to `message` as `question: answer` lines via the shared `formatKeyValueDump()`.

## Test payloads are accepted but never stored

Google sends `is_test: true` payloads so the webhook can be validated from the Google Ads UI during setup (and potentially re-checked later). These are accepted with `200 {}` — required, so setup verification succeeds — but never written to `inbound_leads`, so the inbox doesn't accumulate permanent test rows every time the connection gets re-verified.

## Setup

1. Generate a webhook secret in this business's General Settings → Operational card ("Google Lead Form webhook key").
2. In Google Ads, open the lead form asset → **Export leads** → **Other data integration options** → **Webhook integration**.
3. Webhook URL: `https://<your-domain>/b/<businessId>/webhooks/google-lead-form`.
4. Webhook key: the secret from step 1.
5. Send a test lead from the Google Ads UI to confirm — it should show up accepted (200) in this app's logs, but not appear in the Leads inbox (by design — see above).

## Verified

A simulated real payload (matching Google's documented schema exactly) posted directly to a running dev server: correct field mapping (name/phone/email extracted, a custom question correctly dumped into the message), correct `sourceDetail` (`LEAD_FORM`), wrong `google_key` → `400 {"message": ...}`, `is_test: true` → `200 {}` with no row written, and a re-delivery of the same `lead_id` with updated field values correctly updating the existing row in place rather than creating a duplicate (confirmed via a direct `GET /leads` before/after). Not yet verified: a real lead from Google's own live webhook delivery (blocked on a business actually configuring this in their Google Ads account) — the payload shape and response contract are taken directly from Google's own documentation, not guessed.
