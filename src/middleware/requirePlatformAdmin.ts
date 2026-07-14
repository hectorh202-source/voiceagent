import type { NextFunction, Request, Response } from "express";

// Must run after requireAdminSession (needs req.currentUser). Gates the
// global business/user-management console — a non-admin user is scoped to
// specific businesses, not every business, so there's nothing for them to
// see here; redirect to the SPA, which resolves to their own first assigned
// business via FirstBusinessRedirect.
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.currentUser?.isPlatformAdmin) {
    next();
    return;
  }
  res.redirect("/app");
}
