import axios from "axios";
import type { ServiceTitanConfig } from "../settings/store";

interface CachedToken {
  token: string;
  expiresAt: number;
  cacheKey: string;
}

let cached: CachedToken | null = null;

export async function getAccessToken(config: ServiceTitanConfig): Promise<string> {
  const cacheKey = `${config.clientId}:${config.authBaseUrl}`;
  const now = Date.now();
  if (cached && cached.cacheKey === cacheKey && cached.expiresAt - 60_000 > now) {
    return cached.token;
  }

  const response = await axios.post<{ access_token: string; expires_in: number }>(
    `${config.authBaseUrl}/connect/token`,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  cached = {
    token: response.data.access_token,
    expiresAt: now + response.data.expires_in * 1000,
    cacheKey,
  };
  return cached.token;
}
