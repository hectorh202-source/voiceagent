import { Router } from "express";
import { handlePostCallWebhook } from "./postCall";
import { handleTwilioCallStatus, handleTwilioRecordingStatus } from "./twilio";
import { handleLeadIntake } from "./leadIntake";
import { handleGoogleLeadFormWebhook } from "./googleLeadForm";
import { verifyLeadIntakeSecret } from "../middleware/verifyLeadIntakeSecret";

export const webhooksRouter = Router();

webhooksRouter.post("/elevenlabs/post-call", handlePostCallWebhook);
webhooksRouter.post("/twilio/call-status", handleTwilioCallStatus);
webhooksRouter.post("/twilio/recording-status", handleTwilioRecordingStatus);
webhooksRouter.post("/leads/inbound", verifyLeadIntakeSecret, handleLeadIntake);
// No shared secret middleware here — Google's own required response
// contract ({"message": "..."} on 4xx/5xx, {} on 200) doesn't match this
// app's usual {error} shape, so auth is validated inline in the handler.
webhooksRouter.post("/google-lead-form", handleGoogleLeadFormWebhook);
