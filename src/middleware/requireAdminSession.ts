import type { NextFunction, Request, Response } from "express";
import { getUserById } from "../db/users";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

export function requireAdminSession(req: Request, res: Response, next: NextFunction): void {
  if (req.session.userId) {
    const user = getUserById(req.session.userId);
    if (user) {
      req.currentUser = user;
      next();
      return;
    }
    // Stale session for a since-deleted user — fall through to redirect.
    req.session.userId = undefined;
  }
  const returnTo = encodeURIComponent(req.originalUrl);
  res.redirect(`/settings/login?returnTo=${returnTo}`);
}
