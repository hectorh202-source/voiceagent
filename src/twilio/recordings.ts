import { requireTwilioConfig, twRequest } from "./httpClient";

// Starts recording an already-in-progress Call. This is the only viable
// mechanism for capturing the human portion of a transferred call: the
// Conference the call gets bridged into is created by ElevenLabs' own Twilio
// integration, not by this app, and Twilio only supports requesting
// Conference-level recording via TwiML at conference-creation time — never
// retroactively via the REST API. Call-level recording on the original
// inbound Call leg has no such restriction and can be started at any point
// while the call is live (confirmed against Twilio's own API reference).
//
// The resulting recording spans the whole call — AI portion included, not
// just the transferred segment — since there's no way to start it only once
// the transfer happens (this app doesn't control the Voice URL that runs the
// call, ElevenLabs' own backend does, so there's no reliable in-call hook to
// react to). The AI portion is trimmed out client-side via player seek
// instead (see CallDetailPage.tsx), using the transfer's time_in_call_secs
// from the transcript as the offset.
export async function startCallRecording(callSid: string, recordingStatusCallbackUrl: string): Promise<void> {
  const config = requireTwilioConfig();
  const body = new URLSearchParams({
    RecordingStatusCallback: recordingStatusCallbackUrl,
    RecordingStatusCallbackEvent: "completed",
  });
  await twRequest(config, "POST", `/2010-04-01/Accounts/${config.accountSid}/Calls/${callSid}/Recordings.json`, {
    data: body,
  });
}

export async function downloadRecording(recordingSid: string): Promise<Buffer> {
  const config = requireTwilioConfig();
  const data = await twRequest<ArrayBuffer>(
    config,
    "GET",
    `/2010-04-01/Accounts/${config.accountSid}/Recordings/${recordingSid}.mp3`,
    { responseType: "arraybuffer" },
  );
  return Buffer.from(data);
}
