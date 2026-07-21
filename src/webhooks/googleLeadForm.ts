import type { Request, Response } from "express";
import crypto from "node:crypto";
import { getBusinessSetting } from "../settings/store";
import { insertInboundLead } from "../db/inboundLeads";
import { formatKeyValueDump } from "../lib/format";

// Google's Lead Form Extension webhook — a real push mechanism, unlike
// Google Local Services Ads (googleLsa/pollLeads.ts), which has no webhook
// at all and must be polled via GAQL. Confirmed against Google's real
// documentation (2026-07-21): the payload is a flat WebhookLead object with
// a `google_key` field for auth (checked against a value pasted into
// Google Ads' own "Webhook integration" UI, not a header/query secret like
// this app's other webhooks) and a `user_column_data` array of
// {column_id, column_name, string_value} — one entry per form question,
// column_id being Google's fairly stable field-type enum (FULL_NAME,
// FIRST_NAME, LAST_NAME, EMAIL, PHONE_NUMBER, plus many form-specific
// custom question types).
//
// Google's own documented response contract (must be followed exactly,
// not this app's usual {error}/{success} shapes, since Google's own
// delivery system parses these):
//   - 200 with `{}` body = accepted.
//   - 4xx with `{"message": "..."}` = non-retryable (Google won't resend).
//   - 5xx with `{"message": "..."}` = retryable (Google will resend).
// Delivery also isn't guaranteed exactly-once, so this relies on the same
// ON CONFLICT ... DO UPDATE upsert insertInboundLead() already uses for
// Google LSA's polling, keyed on lead_id as external_id.

interface UserColumnDatum {
  column_id?: string;
  column_name?: string;
  string_value?: string;
}

interface WebhookLeadBody {
  lead_id?: string;
  google_key?: string;
  is_test?: boolean;
  lead_source?: string; // "LEAD_FORM" | "CONVERSATIONAL_AGENT"
  lead_submit_time?: string;
  form_id?: string | number;
  campaign_id?: string | number;
  gcl_id?: string;
  user_column_data?: UserColumnDatum[];
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

// Matches by column_id first (Google's own stable enum), falling back to a
// substring match on column_id/column_name for any custom or future field
// type — same "recall over precision" reasoning as leadIntake.ts's own
// field matching, since losing a lead's contact info outright is worse
// than an occasional odd placement.
function isNameColumn(id: string): "full" | "first" | "last" | false {
  if (id === "FULL_NAME") return "full";
  if (id === "FIRST_NAME") return "first";
  if (id === "LAST_NAME") return "last";
  if (id.includes("FIRST") && id.includes("NAME")) return "first";
  if (id.includes("LAST") && id.includes("NAME")) return "last";
  if (id.includes("NAME") && !id.includes("COMPANY")) return "full";
  return false;
}

function buildLeadFields(columns: UserColumnDatum[]): { name?: string; phone?: string; email?: string; message?: string } {
  let full: string | undefined;
  let first: string | undefined;
  let last: string | undefined;
  let phone: string | undefined;
  let email: string | undefined;
  const leftover: Record<string, string> = {};

  for (const col of columns) {
    const value = col.string_value;
    if (!value || value.trim() === "") continue;
    const id = (col.column_id ?? "").toUpperCase();
    const label = col.column_name || col.column_id || "field";

    const nameKind = isNameColumn(id);
    if (nameKind === "full" && !full) {
      full = value;
    } else if (nameKind === "first" && !first) {
      first = value;
    } else if (nameKind === "last" && !last) {
      last = value;
    } else if (id.includes("PHONE") && !phone) {
      phone = value;
    } else if (id.includes("EMAIL") && !email) {
      email = value;
    } else {
      leftover[label] = value;
    }
  }

  const combinedFirstLast = [first, last].filter((v): v is string => !!v).join(" ") || undefined;
  const name = full ?? combinedFirstLast;
  const message = formatKeyValueDump(leftover) || undefined;
  return { name, phone, email, message };
}

export async function handleGoogleLeadFormWebhook(req: Request, res: Response): Promise<void> {
  const { business } = req;
  if (!business) {
    fail(res, 404, "Unknown business");
    return;
  }

  const secret = getBusinessSetting(business.id, "operational.googleLeadFormWebhookSecret");
  if (!secret) {
    fail(res, 400, "Google Lead Form webhook is not configured yet for this business.");
    return;
  }

  const body = req.body as WebhookLeadBody;
  const providedBuf = Buffer.from(body.google_key ?? "");
  const expectedBuf = Buffer.from(secret);
  const isValid = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!isValid) {
    fail(res, 400, "Invalid or missing google_key");
    return;
  }

  if (!body.lead_id) {
    fail(res, 400, "Missing lead_id");
    return;
  }

  // Google explicitly sends test payloads (is_test: true) so the webhook
  // can be validated from the Google Ads UI during setup — accepted, but
  // never written to inbound_leads, so the inbox doesn't accumulate
  // permanent test rows every time someone re-checks the connection.
  if (body.is_test) {
    console.log(`Google Lead Form test payload received for business ${business.id}, lead_id=${body.lead_id}`);
    res.status(200).json({});
    return;
  }

  const { name, phone, email, message } = buildLeadFields(body.user_column_data ?? []);

  insertInboundLead({
    businessId: business.id,
    source: "google_ads",
    sourceDetail: body.lead_source ?? null,
    externalId: body.lead_id,
    name,
    phone,
    email,
    message,
    rawPayloadJson: JSON.stringify(req.body),
  });

  res.status(200).json({});
}
