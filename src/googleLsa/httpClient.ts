import axios from "axios";
import type { GoogleLsaConfig } from "../settings/store";
import { getAccessToken } from "./authClient";

// Confirmed via a real 404 (2026-07-17): v18 (the version guessed when this
// file was first written) has been fully sunset — Google Ads API versions
// have a limited support window and are removed from routing entirely once
// retired, not just deprecated-with-warning. v24 is the current recommended
// version as of this fix; bump this again once Google moves past it.
const API_VERSION = "v24";

interface GaqlSearchResponse<T> {
  results?: T[];
}

// Confirmed via a real 404 (2026-07-17): Google Ads account IDs are shown
// everywhere in Google's own UI (and in this app's own placeholder text,
// "123-456-7890") formatted with dashes, but the API rejects a dashed ID in
// both the URL path and the login-customer-id header — it wants plain
// digits only. Normalizing here means the settings UI never has to nag
// anyone about the exact format they typed a Customer ID in.
function digitsOnly(id: string): string {
  return id.replace(/\D/g, "");
}

// Plain REST + GAQL via axios, not the official google-ads-api/google-ads-node
// SDK (gRPC/protobuf, opinionated config) — consistent with how every other
// integration in this codebase (ElevenLabs/Twilio/ServiceTitan) is plain
// REST via axios. See docs/google-lsa-leads.md.
export async function gaqlSearch<T>(config: GoogleLsaConfig, query: string): Promise<T[]> {
  const token = await getAccessToken(config);
  const response = await axios.post<GaqlSearchResponse<T>>(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${digitsOnly(config.customerId)}/googleAds:search`,
    { query },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": config.developerToken,
        "login-customer-id": digitsOnly(config.loginCustomerId),
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
