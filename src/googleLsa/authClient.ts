import axios from "axios";
import type { GoogleLsaConfig } from "../settings/store";

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Keyed by refreshToken rather than businessId — cheap insurance against two
// businesses ever sharing one cache slot if a refreshToken were ever reused,
// mirrors servicetitan/authClient.ts's per-credential cache key exactly.
const cache = new Map<string, CachedToken>();

export async function getAccessToken(config: GoogleLsaConfig): Promise<string> {
  const cacheKey = config.refreshToken;
  const now = Date.now();
  const existing = cache.get(cacheKey);
  if (existing && existing.expiresAt - 60_000 > now) {
    return existing.token;
  }

  const response = await axios.post<{ access_token: string; expires_in: number }>(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  const entry: CachedToken = {
    token: response.data.access_token,
    expiresAt: now + response.data.expires_in * 1000,
  };
  cache.set(cacheKey, entry);
  return entry.token;
}
