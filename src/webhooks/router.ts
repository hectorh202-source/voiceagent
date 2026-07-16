import { Router } from "express";
import { handlePostCallWebhook } from "./postCall";
import { handleTwilioCallStatus, handleTwilioRecordingStatus } from "./twilio";

export const webhooksRouter = Router();

webhooksRouter.post("/elevenlabs/post-call", handlePostCallWebhook);
webhooksRouter.post("/twilio/call-status", handleTwilioCallStatus);
webhooksRouter.post("/twilio/recording-status", handleTwilioRecordingStatus);
