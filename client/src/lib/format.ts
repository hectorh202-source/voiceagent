import type { LeadSource } from "../api/types";

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
