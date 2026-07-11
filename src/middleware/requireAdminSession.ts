import type { NextFunction, Request, Response } from "express";

declare module "express-session" {
  interface SessionData {
    isAdmin?: boolean;
  }
}

export function requireAdminSession(req: Request, res: Response, next: NextFunction): void {
  if (req.session.isAdmin) {
    next();
    return;
  }
  const returnTo = encodeURIComponent(req.originalUrl);
  res.redirect(`/settings/login?returnTo=${returnTo}`);
}
