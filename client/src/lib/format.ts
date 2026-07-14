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
