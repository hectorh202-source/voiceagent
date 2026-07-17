// Formats a US phone number as +1(XXX) XXX-XXXX regardless of how it was
// originally stored (with/without +1, dashes, spaces) — falls back to the
// raw value for anything that isn't a recognizable 10-digit US number.
export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (tenDigits.length !== 10) return phone;
  return `+1(${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

// Plain "Key: Value" lines, one per entry — used both by leadIntake.ts's
// unrecognized-field fallback (a filtered subset of a submission's fields)
// and by the Leads API's always-present raw-dump section (every field,
// unfiltered), so the two read consistently even though their inputs differ.
export function formatKeyValueDump(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, value]) => typeof value === "string" && value.trim() !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}
