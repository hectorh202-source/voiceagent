import type { Request, Response } from "express";
import { leadIntakeSchema } from "../api/schemas";
import { insertInboundLead } from "../db/inboundLeads";
import { formatKeyValueDump } from "../lib/format";

// Confirmed against a real Elementor Pro Forms submission: every client's
// form is labeled differently, and there's no universal fixed field name to
// match against. Rather than a hand-picked exact-match alias list (which
// already failed the moment a real form's labels didn't match it exactly —
// see git history), fields are matched by *substring*, case-insensitively,
// in priority order. Deliberately broad: a false-positive match just means
// a field lands somewhere slightly odd, whereas a missed match means losing
// a lead's contact info outright, which is the worse failure mode here.
// "number" added after a real test (2026-07-19) against a differently-
// labeled form tool: "Best Contact Number" has neither "phone"/"mobile"/
// "cell" in it, so a phone number was silently falling out of the
// structured field into the plain message dump instead. No collision risk
// introduced by this: name/address/email's own substrings don't overlap
// with "number" at all, and every field on a lead-intake form is already
// scoped to "info about this one contact request" (not a general business
// form with unrelated reference/order/invoice numbers), so the broad match
// stays safe in this specific context.
const FIELD_SUBSTRINGS = {
  phone: ["phone", "mobile", "cell", "number"],
  address: ["address", "street"],
  email: ["mail"],
  message: ["message", "comment", "note", "detail", "inquiry", "enquiry"],
  name: ["name"],
} as const;

// Elementor's own fixed system fields (present on every submission
// regardless of what the business's form actually asks) — "form_name"
// would otherwise false-match the "name" substring above, misreading the
// form's own title as the lead's name. "source"/"sourceDetail"/"externalId"
// are this endpoint's own meta fields (read explicitly below) — excluded so a
// caller that sends them as body keys (e.g. the chat-widget service) doesn't
// get them appended into the visible message dump.
const IGNORED_KEYS = new Set(["form_id", "form_name", "source", "sourceDetail", "externalId"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function matchesField(key: string, field: keyof typeof FIELD_SUBSTRINGS): boolean {
  if (IGNORED_KEYS.has(key)) return false;
  const lower = key.toLowerCase();
  return FIELD_SUBSTRINGS[field].some((substring) => lower.includes(substring));
}

// Finds the first not-yet-claimed field matching one of FIELD_SUBSTRINGS,
// claiming its key so later extractions (and the leftover dump below) never
// reuse the same field twice.
function extractField(
  body: Record<string, unknown>,
  field: keyof typeof FIELD_SUBSTRINGS,
  usedKeys: Set<string>,
): string | undefined {
  for (const [key, value] of Object.entries(body)) {
    if (usedKeys.has(key) || !isNonEmptyString(value) || !matchesField(key, field)) continue;
    usedKeys.add(key);
    return value;
  }
  return undefined;
}

// A single "name" field is the common case, but Elementor's own default
// form splits it into "First Name"/"Last Name" — combined here since this
// app only ever tracks one name string per lead.
function extractName(body: Record<string, unknown>, usedKeys: Set<string>): string | undefined {
  let first: string | undefined;
  let last: string | undefined;
  for (const [key, value] of Object.entries(body)) {
    if (usedKeys.has(key) || !isNonEmptyString(value) || IGNORED_KEYS.has(key)) continue;
    const lower = key.toLowerCase();
    if (first === undefined && lower.includes("first") && lower.includes("name")) {
      first = value;
      usedKeys.add(key);
    } else if (last === undefined && lower.includes("last") && lower.includes("name")) {
      last = value;
      usedKeys.add(key);
    }
  }
  if (first !== undefined || last !== undefined) {
    return [first, last].filter(isNonEmptyString).join(" ");
  }
  return extractField(body, "name", usedKeys);
}

// Every field not already claimed as name/phone/email/address becomes part
// of the visible message — appended after a direct "message"-like field if
// one exists, not instead of it. A form with both a "Comments" field and a
// one-off custom question (e.g. "Are you a new customer?") used to lose
// that second field entirely from the lead's visible details the moment a
// direct message match existed, even though it was still sitting in
// raw_payload_json all along — confirmed as a real bug (2026-07-19), not
// just a hypothetical. Appending the leftover dump unconditionally means a
// business's own staff can always read exactly what a differently-labeled,
// unrecognized field submitted directly in the inbox, without anyone
// needing a database script to go dig through the raw payload — this is
// the one place this endpoint can compensate for a client's form asking a
// question this app has no dedicated column for, current or future.
function extractMessageOrDump(body: Record<string, unknown>, usedKeys: Set<string>): string | undefined {
  const direct = extractField(body, "message", usedKeys);

  const leftover = Object.fromEntries(Object.entries(body).filter(([key]) => !usedKeys.has(key) && !IGNORED_KEYS.has(key)));
  const dump = formatKeyValueDump(leftover);

  if (direct && dump) return `${direct}\n\n${dump}`;
  return direct || dump || undefined;
}

// Generic intake for the two lead sources that don't need their own
// integration (a business's website contact form or chat widget POSTs
// here directly — no OAuth, no per-vendor payload mapping). Facebook/Google
// ads leads, once built, write to inbound_leads directly from their own
// ingestion modules rather than through this endpoint.
export async function handleLeadIntake(req: Request, res: Response): Promise<void> {
  const { business } = req;
  if (!business) {
    res.status(404).end();
    return;
  }

  const body = req.body as Record<string, unknown>;
  const usedKeys = new Set<string>();

  // Elementor's Webhook action has no field for a fixed extra value like
  // "source" — defaulting to "website_form" here means it doesn't need one;
  // a tool that genuinely is a chat widget can still send an explicit
  // source to override this. Extraction order matters: name/phone/address/
  // email each claim their own field before message's fallback dump runs,
  // so whatever they found is excluded from that dump rather than
  // duplicated — and address is deliberately extracted *before* email
  // specifically, since "Mailing Address" contains "mail" and would
  // otherwise get misclaimed by email's own (deliberately broad) substring
  // match before address ever got a turn.
  const normalized = {
    source: typeof body.source === "string" ? body.source : "website_form",
    // A plain sub-classification (not PII) — the chat-widget service sends
    // "booked"/"lead"; form builders never set it. Read explicitly, not
    // fuzzy-matched.
    sourceDetail: typeof body.sourceDetail === "string" ? body.sourceDetail : undefined,
    name: extractName(body, usedKeys),
    phone: extractField(body, "phone", usedKeys),
    address: extractField(body, "address", usedKeys),
    email: extractField(body, "email", usedKeys),
    message: extractMessageOrDump(body, usedKeys),
    externalId: typeof body.externalId === "string" ? body.externalId : undefined,
  };

  const parsed = leadIntakeSchema.safeParse(normalized);
  if (!parsed.success) {
    // Should be effectively unreachable now (leadIntakeSchema has no
    // required fields left) — kept as a safety net, logged unconditionally
    // in case some genuinely new shape of body breaks an assumption above.
    console.log("Lead intake validation failed. Raw body:", JSON.stringify(req.body));
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { source, sourceDetail, name, phone, address, email, message, externalId } = parsed.data;
  insertInboundLead({
    businessId: business.id,
    source,
    sourceDetail,
    externalId,
    name,
    phone,
    address,
    email,
    message,
    rawPayloadJson: JSON.stringify(req.body),
  });

  // Deliberately 200, not the more conventional 201 for a created resource —
  // confirmed Elementor Pro Forms' Webhook action only treats a literal 200
  // as success and throws a "Webhook Error" for anything else (201, 204,
  // etc.), and compatibility with third-party form tools is this endpoint's
  // entire reason to exist.
  res.status(200).json({ success: true });
}
