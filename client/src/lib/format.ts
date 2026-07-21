import type { LeadSource, LeadStatus, LeadNameSource } from "../api/types";

// Shown as an empty secret input's placeholder when the server reports a
// value is already set (the real value is never sent back, only a boolean
// flag) — same pattern as Stripe/GitHub's settings pages, where an
// already-configured secret's field shows masked dots rather than looking
// indistinguishable from a field that was never set at all.
export const MASKED_SECRET_PLACEHOLDER = "••••••••••••••••";

export function formatDuration(secs: number | null): string {
  if (secs === null) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

export function formatDurationClock(secs: number | null): string {
  if (secs === null) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

// Billing-oriented — a whole-minute count is what matters for "how many
// minutes did we use," not seconds-level precision. Rounds up (like most
// usage-based billing) rather than down, so this never under-reports.
export function formatTotalMinutes(secs: number): string {
  const minutes = Math.ceil(secs / 60);
  return `${minutes.toLocaleString()} min`;
}

// Mirrors src/lib/format.ts's formatPhoneNumber exactly — falls back to the
// raw value for anything that isn't a recognizable 10-digit US number.
export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (tenDigits.length !== 10) return phone;
  return `+1(${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

const LEAD_SOURCE_LABEL: Record<string, string> = {
  website_form: "Website form",
  website_chat: "Website chat",
  facebook_ads: "Facebook Ads",
  google_ads: "Google Ads (Lead Form)",
  google_lsa: "Google LSA",
};

// Google's own lead_type enum values, surfaced on source_detail — currently
// only populated for google_lsa leads. Shown as a suffix so a Google LSA
// phone-call lead reads differently from a Google LSA message lead in the
// Source column, rather than both just showing "Google LSA".
const SOURCE_DETAIL_LABEL: Record<string, string> = {
  PHONE_CALL: "Phone Call",
  MESSAGE: "Message",
  // website_chat sub-detail: whether the widget booked a real appointment or
  // just forwarded a lead for staff to schedule (see src/chat/engine.ts).
  booked: "Booked",
  lead: "Lead",
  // google_ads (Lead Form Extension) sub-detail: Google's own lead_source
  // field — a form attached to a regular ad vs. a conversational (chat-style)
  // ad experience, both delivered through the same webhook.
  LEAD_FORM: "Lead Form",
  CONVERSATIONAL_AGENT: "Conversational Agent",
};

// Single shared source label, used by LeadsPage/LeadsFiltersPanel/
// LeadDetailPage so a new lead source or sourceDetail value only ever needs
// updating here, not in three separate copy-pasted maps (the bug this fixed:
// google_lsa was added as a real source before the client had a label for
// it at all, so every google_lsa lead's Source column rendered blank).
export function getLeadSourceLabel(source: string, sourceDetail?: string | null): string {
  const base = LEAD_SOURCE_LABEL[source] ?? source;
  const detail = sourceDetail ? SOURCE_DETAIL_LABEL[sourceDetail] ?? sourceDetail : null;
  return detail ? `${base} — ${detail}` : base;
}

// The filter dropdown's option list — same reasoning as getLeadSourceLabel
// above, one shared source of truth instead of a separately maintained list.
export const LEAD_SOURCE_OPTIONS: { value: LeadSource; label: string }[] = (
  Object.keys(LEAD_SOURCE_LABEL) as LeadSource[]
).map((value) => ({ value, label: LEAD_SOURCE_LABEL[value] }));

// Mirrors CallDetailPage.tsx's CALL_REASON_GROUPS taxonomy exactly, minus
// the "Outbound" group (leads are always inbound) — kept here rather than
// imported from CallDetailPage.tsx so this file (already the shared home
// for Leads' other label/format helpers) doesn't import a page component,
// and so a change to Call Reason's own list doesn't silently ripple into
// Leads' status options without a deliberate edit here too. If Call
// Reason's list changes, update both call sites by hand — matches how the
// server's independent LEAD_STATUS_VALUES (src/api/schemas.ts) already
// mirrors this same taxonomy without importing it either.
export const LEAD_STATUS_GROUPS: { label: string; options: string[] }[] = [
  { label: "Booked", options: ["Booked - Repair", "Booked - Maintenance", "Booked - Sales/Estimate", "Booked - Service"] },
  {
    label: "Follow Up",
    options: [
      "Follow Up - Cancel",
      "Follow Up - Membership Cancel",
      "Follow Up - ETA",
      "Follow Up - Reschedule",
      "Follow Up - Other Update",
      "Follow Up - Complaint",
      "Follow Up - Compliment",
      "Follow Up - Invoice/Payment",
      "Follow Up - Confirming Time",
    ],
  },
  {
    label: "Excused",
    options: [
      "Excused - Test Call",
      "Excused - Outside of Area",
      "Excused - Outside of Services",
      "Excused - Telemarketing",
      "Excused - Spam",
      "Excused - Internal Call",
      "Excused - Employment",
      "Excused - Update Profile",
      "Excused - Other Questions",
      "Excused - No Reason",
      "Excused - Silent Call",
      "Excused - Not Homeowner",
      "Excused - Installation Call",
      "Excused - Live Agent Request",
      "Excused - Transfer to Specific Person",
      "Excused - Membership Inquiry",
      "Excused - Installation Pictures",
      "Excused - Returning Call",
    ],
  },
  {
    label: "Unbooked",
    options: [
      "Unbooked - Reject Agent",
      "Unbooked - Time Concern",
      "Unbooked - Price Concern",
      "Unbooked - Call Back Later",
      "Unbooked - Trip Charge",
      "Unbooked - Commercial",
      "Unbooked - Pending Coordination",
      "Unbooked - Callback (Previous Job)",
    ],
  },
  { label: "Other", options: ["Other"] },
];

// One color per main category (not per individual reason — there are ~40
// of those) — reuses the same tokens already established for other status-
// like indicators elsewhere (success/progress/neutral/danger/warning)
// rather than inventing a sixth palette.
const LEAD_STATUS_GROUP_COLOR: Record<string, { bg: string; fg: string }> = {
  Booked: { bg: "var(--success-bg)", fg: "var(--success-text)" },
  "Follow Up": { bg: "var(--progress-bg)", fg: "var(--progress-text)" },
  Excused: { bg: "var(--neutral-bg)", fg: "var(--neutral-text)" },
  Unbooked: { bg: "var(--danger-bg)", fg: "var(--danger-text)" },
  Other: { bg: "var(--warning-bg)", fg: "var(--warning-text)" },
};

// Flattened option -> parent group label, so a specific status string (e.g.
// "Booked - Repair") can be colored by its category without the caller
// needing to know which group it belongs to.
const LEAD_STATUS_TO_GROUP: Record<string, string> = Object.fromEntries(
  LEAD_STATUS_GROUPS.flatMap((group) => group.options.map((option) => [option, group.label])),
);

// "New" is deliberately not part of any group above — unlike a completed
// call, a lead that hasn't been triaged yet has no equivalent in Call
// Reason's own taxonomy, so it stays a standalone first option instead of
// being force-fit into one of the borrowed categories.
export function getLeadStatusLabel(status: LeadStatus): string {
  return status === "new" ? "New" : status;
}

// Falls back to a plain neutral tint for anything outside the current
// taxonomy — specifically existing leads still holding a retired value
// (contacted/qualified/won/lost) from before this taxonomy replaced the
// original 5-value status. Those are deliberately left as-is in the data
// (see src/api/schemas.ts's LEAD_STATUS_VALUES) rather than auto-migrated,
// so this needs to render *something* sensible for them rather than
// crashing on a missing lookup key.
export function getLeadStatusColors(status: LeadStatus): { bg: string; fg: string } {
  if (status === "new") return { bg: "var(--info-bg)", fg: "var(--info-text)" };
  const group = LEAD_STATUS_TO_GROUP[status];
  return group ? LEAD_STATUS_GROUP_COLOR[group] : { bg: "var(--neutral-bg)", fg: "var(--neutral-text)" };
}

// Surfaces, next to a Google LSA phone-call lead's name, how confident that
// name actually is — a ServiceTitan CRM match is a real customer record,
// while a Caller ID (Twilio CNAM) result is only ever a best-effort phone-
// carrier guess (see googleLsa/nameSource.ts). Shows nothing at all for a
// MESSAGE lead (name came straight from Google) or an unresolved one.
export function getNameSourceLabel(source: LeadNameSource): string | null {
  if (source === "servicetitan") return "Verified via ServiceTitan";
  if (source === "caller_id") return "Caller ID";
  return null;
}

export function getNameSourceColors(source: LeadNameSource): { bg: string; fg: string } {
  if (source === "servicetitan") return { bg: "var(--success-bg)", fg: "var(--success-text)" };
  return { bg: "var(--warning-bg)", fg: "var(--warning-text)" };
}

// Up to 2 initials from a display name (or "?" for an unknown/empty one) —
// used by the .lead-avatar circles in LeadsPage.tsx/LeadDetailPage.tsx.
export function getInitials(name: string | null): string {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase();
}

// A small fixed palette of avatar background colors, picked deterministically
// from the name itself (a simple char-code hash) — same name always gets the
// same color across the list and detail views, without needing to store a
// color anywhere. Not tied to lead status/source; purely a Gmail/Slack-style
// visual distinguisher between rows.
const AVATAR_COLORS = ["#635bff", "#ec4899", "#0f9d58", "#f59e0b", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"];

export function avatarColorFor(seed: string | null): string {
  const value = seed && seed.trim() ? seed : "?";
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
