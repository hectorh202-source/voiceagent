import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { getBusinessSetting } from "../settings/store";

// Byte-for-byte the same shape as middleware/verifyToolSecret.ts — a plain
// shared secret (not HMAC), since this is meant to be pasted into whatever
// simple form-builder or chat-widget tool a business's website uses, not a
// platform with its own signing scheme like ElevenLabs/Twilio.
export function verifyLeadIntakeSecret(req: Request, res: Response, next: NextFunction): void {
  const business = req.business;
  if (!business) {
    res.status(404).end();
    return;
  }

  const secret = getBusinessSetting(business.id, "operational.leadIntakeWebhookSecret");
  if (!secret) {
    res.status(503).json({ error: "Lead intake is not configured yet. Visit General Settings to finish setup." });
    return;
  }

  const provided = req.header("X-Lead-Intake-Secret");
  if (!provided) {
    res.status(401).json({ error: "Missing X-Lead-Intake-Secret header" });
    return;
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(secret);
  const isValid =
    providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!isValid) {
    res.status(401).json({ error: "Invalid lead intake secret" });
    return;
  }

  next();
}
