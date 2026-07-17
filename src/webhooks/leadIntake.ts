import type { Request, Response } from "express";
import { leadIntakeSchema } from "../api/schemas";
import { insertInboundLead } from "../db/inboundLeads";

// Confirmed against a real Elementor Pro Forms submission: it keys each
// field by its visible label (case-preserved), not a fixed name — e.g.
// "Phone", "Email", "First Name"/"Last Name" split instead of a single
// "name". Businesses can't reasonably be asked to rename their own
// user-facing form field labels to lowercase "phone"/"email"/etc. just to
// match this endpoint's contract, so incoming keys are matched
// case-insensitively against a small alias list instead of requiring an
// exact match. Kept intentionally small (only the aliases confirmed from a
// real payload) rather than trying to guess every label some future form
// might use — extend this list if a genuinely new tool needs it, verified
// against its own real payload the same way this one was.
const FIELD_ALIASES = {
  name: ["name", "full name", "your name"],
  phone: ["phone", "phone number", "telephone", "mobile"],
  email: ["email", "email address"],
  message: ["message", "comments", "additional info", "details"],
} as const;

function findByAlias(body: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    if (aliases.includes(key.trim().toLowerCase())) return value;
  }
  return undefined;
}

// Elementor's default "Name" field is actually two separate fields, "First
// Name" and "Last Name" — combined here since this app only ever tracks one
// name string per lead.
function extractName(body: Record<string, unknown>): string | undefined {
  const direct = findByAlias(body, FIELD_ALIASES.name);
  if (direct) return direct;
  const first = findByAlias(body, ["first name"]);
  const last = findByAlias(body, ["last name"]);
  return first || last ? [first, last].filter(Boolean).join(" ") : undefined;
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
  // Elementor's Webhook action has no field for a fixed extra value like
  // "source" — defaulting to "website_form" here means it doesn't need one;
  // a tool that genuinely is a chat widget can still send an explicit
  // source to override this.
  const normalized = {
    source: typeof body.source === "string" ? body.source : "website_form",
    name: extractName(body),
    phone: findByAlias(body, FIELD_ALIASES.phone),
    email: findByAlias(body, FIELD_ALIASES.email),
    message: findByAlias(body, FIELD_ALIASES.message),
    externalId: typeof body.externalId === "string" ? body.externalId : undefined,
  };

  const parsed = leadIntakeSchema.safeParse(normalized);
  if (!parsed.success) {
    // Logged unconditionally on a validation failure (not just the error
    // itself) — the exact keys/shape a given tool sends can't be assumed,
    // so this is the fastest way to see what actually arrived and extend
    // FIELD_ALIASES above rather than guessing again.
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
