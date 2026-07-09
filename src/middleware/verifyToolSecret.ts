import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { getSetting } from "../settings/store";

export function verifyToolSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = getSetting("operational.toolWebhookSecret");
  if (!secret) {
    res.status(503).json({ error: "Server is not configured yet. Visit /settings to finish setup." });
    return;
  }

  const provided = req.header("X-Tool-Secret");
  if (!provided) {
    res.status(401).json({ error: "Missing X-Tool-Secret header" });
    return;
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(secret);
  const isValid =
    providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!isValid) {
    res.status(401).json({ error: "Invalid tool secret" });
    return;
  }

  next();
}
