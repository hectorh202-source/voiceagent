import type { Request, Response } from "express";
import { leadIntakeSchema } from "../api/schemas";
import { insertInboundLead } from "../db/inboundLeads";

// Confirmed against a real Elementor Pro Forms submission: every client's
// form is labeled differently, and there's no universal fixed field name to
// match against. Rather than a hand-picked exact-match alias list (which
// already failed the moment a real form's labels didn't match it exactly —
// see git history), fields are matched by *substring*, case-insensitively,
// in priority order. Deliberately broad: a false-positive match just means
// a field lands somewhere slightly odd, whereas a missed match means losing
// a lead's contact info outright, which is the worse failure mode here.
const FIELD_SUBSTRINGS = {
  phone: ["phone", "mobile", "cell"],
  email: ["mail"],
  message: ["message", "comment", "note", "detail", "inquiry", "enquiry"],
  name: ["name"],
} as const;

// Elementor's own fixed system fields (present on every submission
// regardless of what the business's form actually asks) — "form_name"
// would otherwise false-match the "name" substring above, misreading the
// form's own title as the lead's name.
const IGNORED_KEYS = new Set(["form_id", "form_name"]);

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

// When nothing in the body looks like a "message" field, every remaining
// field (whatever wasn't already claimed as name/phone/email) becomes the
// message instead of being silently dropped — so a business's own staff can
// still read exactly what a differently-labeled, unrecognized form
// submitted directly in the inbox, without anyone needing a database script
// to go dig through the raw payload.
function extractMessageOrDump(body: Record<string, unknown>, usedKeys: Set<string>): string | undefined {
  const direct = extractField(body, "message", usedKeys);
  if (direct) return direct;

  const leftover = Object.entries(body)
    .filter(([key, value]) => !usedKeys.has(key) && !IGNORED_KEYS.has(key) && isNonEmptyString(value))
    .map(([key, value]) => `${key}: ${value}`);
  return leftover.length > 0 ? leftover.join("\n") : undefined;
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
  // source to override this. Extraction order matters: name/phone/email
  // each claim their own field before message's fallback dump runs, so
  // whatever they found is excluded from that dump rather than duplicated.
  const normalized = {
    source: typeof body.source === "string" ? body.source : "website_form",
    name: extractName(body, usedKeys),
    phone: extractField(body, "phone", usedKeys),
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

  const { source, name, phone, email, message, externalId } = parsed.data;
  insertInboundLead({
    businessId: business.id,
    source,
    externalId,
    name,
    phone,
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
