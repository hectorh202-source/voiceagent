import { listBusinesses } from "../db/businesses";
import { getGoogleLsaConfig } from "../settings/store";
import { insertInboundLead } from "../db/inboundLeads";
import { fetchRecentLsaLeads } from "./leads";
import { describeError } from "./httpClient";

let isPolling = false;

// Mirrors twilio/pollCalls.ts's isPolling guard exactly, but loops
// listBusinesses() instead of matching a single shared account by phone
// number — each business's Local Services Ads account is genuinely
// separate (see docs/google-lsa-leads.md's credential-storage section),
// unlike Twilio's one master account.
export async function pollGoogleLsaLeads(): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  try {
    for (const business of listBusinesses()) {
      const config = getGoogleLsaConfig(business.id);
      if (!config) continue; // not configured for this business yet

      try {
        const leads = await fetchRecentLsaLeads(config, business.id);
        for (const lead of leads) {
          insertInboundLead({
            businessId: business.id,
            source: "google_lsa",
            sourceDetail: lead.sourceDetail,
            externalId: lead.externalId,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            message: lead.message,
            rawPayloadJson: lead.rawPayloadJson,
          });
        }
      } catch (error) {
        console.error(`Google LSA poll failed for business ${business.id}:`, describeError(error));
      }
    }
  } finally {
    isPolling = false;
  }
}
