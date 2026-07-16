import { twRequest } from "./httpClient";
import { startCallRecording } from "./recordings";
import { getTwilioConfig, getBusinessSetting } from "../settings/store";
import { claimRecordingRequest } from "../db/twilioRecordings";
import { listBusinesses } from "../db/businesses";

// Matches the domain this app itself is reachable at (see Caddyfile) — same
// hardcoded-fallback pattern settings/store.ts's getDashboardBaseUrl already
// uses for the (different) dashboard subdomain. There's no incoming request
// to derive protocol/host from here, since this runs on a timer rather than
// in response to a webhook.
const APP_BASE_URL = "https://voiceagent.laughslapper.com";

interface TwilioCallSummary {
  sid: string;
  to: string;
}

function lastTenDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

let isPolling = false;

// Confirmed via a real test call: a Twilio phone number's own inbound Voice
// "Call status changes" webhook (configured in Console, what
// webhooks/twilio.ts's handleTwilioCallStatus receives) only ever fires once
// the call is already "completed" — event selection (so it could fire
// earlier, e.g. on "answered"/in-progress) is documented as only available
// on Call resources created via the API/TwiML, not on this per-number
// config. That makes it useless for starting a *live* recording, since the
// call is already over by the time we're notified.
//
// This poll loop is the workaround: check Twilio directly, on a timer, for
// calls that are actually in progress right now, and start recording any we
// haven't already claimed. Deliberately isolated from the live call-
// answering path entirely (doesn't touch ElevenLabs' inbound webhook or
// anything Twilio calls to route the call) — a failure here can delay or
// skip a recording, never break a call, unlike the outage caused earlier by
// editing the primary Voice webhook directly.
export async function pollAndStartRecordings(): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  try {
    const config = getTwilioConfig();
    if (!config) return;

    let calls: TwilioCallSummary[];
    try {
      const data = await twRequest<{ calls: TwilioCallSummary[] }>(
        config,
        "GET",
        `/2010-04-01/Accounts/${config.accountSid}/Calls.json?Status=in-progress&PageSize=50`,
      );
      calls = data.calls ?? [];
    } catch (error) {
      console.error("Failed to poll Twilio for in-progress calls:", error);
      return;
    }
    if (calls.length === 0) return;

    // Matched by the business's own assigned number (operational.twilioPhoneNumber,
    // set in General Settings) rather than assuming every in-progress call on
    // the master account belongs to a business we're tracking.
    const businessPhones = listBusinesses()
      .map((b) => ({ id: b.id, phone: getBusinessSetting(b.id, "operational.twilioPhoneNumber") }))
      .filter((b): b is { id: number; phone: string } => !!b.phone);

    for (const call of calls) {
      const business = businessPhones.find((b) => lastTenDigits(b.phone) === lastTenDigits(call.to));
      if (!business) continue;
      if (!claimRecordingRequest(business.id, call.sid)) continue;

      const recordingStatusCallbackUrl = `${APP_BASE_URL}/b/${business.id}/webhooks/twilio/recording-status`;
      try {
        await startCallRecording(call.sid, recordingStatusCallbackUrl);
      } catch (error) {
        console.error("Failed to start Twilio call recording (poll path):", error);
      }
    }
  } finally {
    isPolling = false;
  }
}
