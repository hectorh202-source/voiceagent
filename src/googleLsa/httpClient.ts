import axios from "axios";
import type { GoogleLsaConfig } from "../settings/store";
import { getAccessToken } from "./authClient";

// Bump if Google deprecates this version before the next check-in.
const API_VERSION = "v18";

interface GaqlSearchResponse<T> {
  results?: T[];
}

// Plain REST + GAQL via axios, not the official google-ads-api/google-ads-node
// SDK (gRPC/protobuf, opinionated config) — consistent with how every other
// integration in this codebase (ElevenLabs/Twilio/ServiceTitan) is plain
// REST via axios. See docs/google-lsa-leads.md.
export async function gaqlSearch<T>(config: GoogleLsaConfig, query: string): Promise<T[]> {
  const token = await getAccessToken(config);
  const response = await axios.post<GaqlSearchResponse<T>>(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${config.customerId}/googleAds:search`,
    { query },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": config.developerToken,
        "login-customer-id": config.loginCustomerId,
      },
    },
  );
  return response.data.results ?? [];
}

// axios' default error.message discards the Google Ads API's actual error
// body, which is where the useful detail lives (e.g. which specific
// permission/access-level check failed) — same reasoning as
// servicetitan/httpClient.ts's describeError().
export function describeError(error: unknown): string {
  if (axios.isAxiosError(error) && error.response?.data) {
    return JSON.stringify(error.response.data);
  }
  return error instanceof Error ? error.message : "Unknown error";
}
