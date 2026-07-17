import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { getBusinessSetting } from "../settings/store";

// Byte-for-byte the same shape as middleware/verifyToolSecret.ts — a plain
// shared secret (not HMAC), since this is meant to be pasted into whatever
// simple form-builder or chat-widget tool a business's website uses, not a
// platform with its own signing scheme like ElevenLabs/Twilio.
//
// Some form builders (confirmed: Elementor Pro's Forms "Webhook" action)
// only accept a plain URL for this kind of integration — no way to attach a
// custom header at all. For those, the secret can ride in the URL itself as
// a `?secret=` query param instead. This is a real, deliberate tradeoff (a
// query string can end up in server access logs or a browser's history more
// easily than a header), accepted here because the alternative is simply not
// being able to support tools like Elementor at all, and a leaked lead-intake
// secret only lets someone submit fake leads into this one inbox — not a
// credential with any broader reach.
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

  const provided = req.header("X-Lead-Intake-Secret") ?? (typeof req.query.secret === "string" ? req.query.secret : undefined);
  if (!provided) {
    res.status(401).json({ error: "Missing lead intake secret (X-Lead-Intake-Secret header or ?secret= query param)" });
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
