import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env";
import { getTwilioConfig } from "../settings/store";
import { verifyTwilioSignature } from "../twilio/signature";
import { startCallRecording, downloadRecording } from "../twilio/recordings";
import { claimRecordingRequest, setRecordingComplete } from "../db/twilioRecordings";

// Twilio Call/Recording SIDs are always "CA"/"RE" + 32 hex chars — enforced
// before either value reaches a filesystem path (the recording file name)
// or a REST API URL, same defensive reasoning as postCall.ts's
// CONVERSATION_ID_PATTERN: these webhooks are signature-verified, but
// nothing about that guarantees the *shape* of an individual field.
const CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/;
const RECORDING_SID_PATTERN = /^RE[0-9a-f]{32}$/;

const recordingsDir = path.join(path.dirname(env.DATABASE_PATH), "recordings");

function fullRequestUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}${req.originalUrl}`;
}

// Confirmed via a real test call that this is NOT where recording actually
// gets started anymore: a phone number's own "Status Callback URL" (set in
// Twilio Console, what fires this handler) only ever sends CallStatus=
// "completed" — event selection (which would let it fire earlier, e.g. on
// "answered") is only available on Call resources created via the API/
// TwiML, not on this per-number config. By the time this fires the call is
// already over, too late to start a recording. See twilio/pollCalls.ts for
// the actual mechanism now in use. This handler is kept only for visibility
// (the log line below) and as a no-op safety net; claimRecordingRequest's
// idempotency guard means even if some Twilio account setting ever does
// deliver an early event here, it can't double-trigger against the poller.
export async function handleTwilioCallStatus(req: Request, res: Response): Promise<void> {
  const { business } = req;
  if (!business) {
    res.status(404).end();
    return;
  }
  const config = getTwilioConfig();
  if (!config) {
    res.status(404).end();
    return;
  }

  const sigHeader = req.header("x-twilio-signature");
  if (!verifyTwilioSignature(fullRequestUrl(req), req.body as Record<string, string>, sigHeader, config.authToken)) {
    res.status(401).send("Invalid signature");
    return;
  }

  const callSid = typeof req.body.CallSid === "string" ? req.body.CallSid : undefined;
  const callStatus = req.body.CallStatus;
  // Logged unconditionally (not just on error) while this is still being
  // verified against a real number's Status Callback — the phone-number-
  // level Status Callback's actual event set (which statuses it fires, and
  // how many times) isn't documented as clearly as a Call resource's own
  // per-call StatusCallbackEvent parameter, so this is the fastest way to
  // confirm what's actually arriving rather than guessing again.
  console.log(`Twilio call-status webhook: CallSid=${callSid} CallStatus=${callStatus}`);
  if (!callSid || callStatus !== "in-progress" || !CALL_SID_PATTERN.test(callSid)) {
    res.status(200).end();
    return;
  }

  if (!claimRecordingRequest(business.id, callSid)) {
    res.status(200).end();
    return;
  }

  const recordingStatusCallbackUrl = `${req.protocol}://${req.get("host")}/b/${business.id}/webhooks/twilio/recording-status`;
  try {
    await startCallRecording(callSid, recordingStatusCallbackUrl);
  } catch (error) {
    console.error("Failed to start Twilio call recording:", error);
  }
  res.status(200).end();
}

// Fired by Twilio once the recording requested above has finished
// processing and is ready to download — the URL itself was supplied by us at
// request time (startCallRecording's recordingStatusCallbackUrl), not
// configured anywhere in Twilio Console.
export async function handleTwilioRecordingStatus(req: Request, res: Response): Promise<void> {
  const { business } = req;
  if (!business) {
    res.status(404).end();
    return;
  }
  const config = getTwilioConfig();
  if (!config) {
    res.status(404).end();
    return;
  }

  const sigHeader = req.header("x-twilio-signature");
  if (!verifyTwilioSignature(fullRequestUrl(req), req.body as Record<string, string>, sigHeader, config.authToken)) {
    res.status(401).send("Invalid signature");
    return;
  }

  const callSid = typeof req.body.CallSid === "string" ? req.body.CallSid : undefined;
  const recordingSid = typeof req.body.RecordingSid === "string" ? req.body.RecordingSid : undefined;
  const status = req.body.RecordingStatus;
  if (!callSid || !recordingSid || status !== "completed" || !CALL_SID_PATTERN.test(callSid) || !RECORDING_SID_PATTERN.test(recordingSid)) {
    res.status(200).end();
    return;
  }

  try {
    const audio = await downloadRecording(recordingSid);
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    const recordingPath = path.join(recordingsDir, `human-${callSid}.mp3`);
    fs.writeFileSync(recordingPath, audio);
    setRecordingComplete(business.id, callSid, recordingSid, recordingPath);
  } catch (error) {
    console.error("Failed to download Twilio recording:", error);
  }
  res.status(200).end();
}
