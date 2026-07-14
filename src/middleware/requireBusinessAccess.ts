import type { NextFunction, Request, Response } from "express";
import { userHasBusinessAccess } from "../db/userBusinesses";

// Must run after resolveBusiness (needs req.business) and requireApiSession
// (needs req.currentUser). Only mounted on the SPA's JSON API
// (src/api/businessRouter.ts) — the ElevenLabs tool webhooks and post-call
// webhook use their own shared-secret auth (unrelated to user sessions), and
// the public per-call page is deliberately unauthenticated; neither needs
// this check.
export function requireBusinessAccess(req: Request, res: Response, next: NextFunction): void {
  if (userHasBusinessAccess(req.currentUser!, req.business!.id)) {
    next();
    return;
  }
  res.status(403).json({ error: "You do not have access to this business" });
}
