import axios from "axios";
import { getTwilioConfig } from "../settings/store";

interface CallerNameLookupResponse {
  caller_name?: {
    caller_name: string | null;
    caller_type: "BUSINESS" | "CONSUMER" | null;
    error_code: string | null;
  } | null;
}

// Twilio's Lookup API lives on a separate host (lookups.twilio.com) from the
// Voice API (api.twilio.com) that twilio/httpClient.ts's twRequest is scoped
// to — a small dedicated request here rather than generalizing that helper
// for this one call. Global config (not per-business), same as every other
// Twilio call in this codebase — one master account.
//
// $0.01 per lookup, billed even when it returns nothing — Twilio's own CNAM
// (Caller ID Name) data is notoriously incomplete for mobile numbers
// specifically (many carriers just don't populate it), so this is a
// best-effort last resort, not a reliable source. US numbers only; anything
// else returns null without being charged (per Twilio's own pricing docs).
export async function lookupCallerName(phone: string): Promise<string | null> {
  const config = getTwilioConfig();
  if (!config) return null;
  try {
    const response = await axios.get<CallerNameLookupResponse>(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}`,
      {
        params: { Fields: "caller_name" },
        auth: { username: config.accountSid, password: config.authToken },
      },
    );
    return response.data.caller_name?.caller_name ?? null;
  } catch {
    return null;
  }
}
