import axios, { type Method } from "axios";
import { getTwilioConfig, type TwilioConfig } from "../settings/store";

export class TwilioNotConfiguredError extends Error {
  constructor() {
    super("Twilio is not configured — add the master Account SID and Auth Token under Admin Settings.");
  }
}

// Global, not per-business — there's a single master Twilio account this
// platform manages, with individual phone numbers assigned to businesses for
// forwarding (see settings/store.ts's getTwilioConfig).
export function requireTwilioConfig(): TwilioConfig {
  const config = getTwilioConfig();
  if (!config) throw new TwilioNotConfiguredError();
  return config;
}

const API_BASE_URL = "https://api.twilio.com";

export async function twRequest<T>(
  config: TwilioConfig,
  method: Method,
  path: string,
  options: { data?: unknown; responseType?: "json" | "arraybuffer" } = {},
): Promise<T> {
  const response = await axios.request<T>({
    method,
    url: `${API_BASE_URL}${path}`,
    data: options.data,
    responseType: options.responseType,
    auth: { username: config.accountSid, password: config.authToken },
  });
  return response.data;
}

// Twilio's own Call resource — the ground truth for a call's caller number,
// independent of anything ElevenLabs' agent did or didn't do mid-call (see
// webhooks/postCall.ts's backfillMissingCustomerInfoFromTwilio). Confirmed
// queryable for 13 months after a call via Twilio's own docs. Swallows its
// own errors (returns null) since every caller already treats "no number
// available" as a normal, expected outcome, not something to propagate.
export async function getCallFromNumber(config: TwilioConfig, callSid: string): Promise<string | null> {
  try {
    const call = await twRequest<{ from?: string }>(
      config,
      "GET",
      `/2010-04-01/Accounts/${config.accountSid}/Calls/${encodeURIComponent(callSid)}.json`,
    );
    return call.from ?? null;
  } catch {
    return null;
  }
}
