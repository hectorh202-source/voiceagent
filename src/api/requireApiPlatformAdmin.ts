import type { NextFunction, Request, Response } from "express";

// JSON counterpart of middleware/requirePlatformAdmin.ts — same check, but
// responds 403 JSON instead of redirecting, since the caller here is the
// SPA's fetch(), not a browser navigation. Must run after requireApiSession.
export function requireApiPlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.currentUser?.isPlatformAdmin) {
    next();
    return;
  }
  res.status(403).json({ error: "Platform admin access required" });
}
