import type { NextFunction, Request, Response } from "express";
import { getUserById } from "../db/users";

// JSON counterpart of middleware/requireAdminSession.ts — same session
// check, but responds 401 JSON instead of redirecting to the login page,
// since the React SPA (not a browser navigation) is what's calling this.
export function requireApiSession(req: Request, res: Response, next: NextFunction): void {
  if (req.session.userId) {
    const user = getUserById(req.session.userId);
    if (user) {
      req.currentUser = user;
      next();
      return;
    }
    req.session.userId = undefined;
  }
  res.status(401).json({ error: "unauthenticated" });
}
