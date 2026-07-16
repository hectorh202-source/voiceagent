import axios, { type Method } from "axios";
import { getTwilioConfig, type TwilioConfig } from "../settings/store";

export class TwilioNotConfiguredError extends Error {
  constructor() {
    super("Twilio is not configured for this business — add an Account SID and Auth Token under General settings.");
  }
}

export function requireTwilioConfig(businessId: number): TwilioConfig {
  const config = getTwilioConfig(businessId);
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
