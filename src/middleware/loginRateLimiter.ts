import type { NextFunction, Request, Response } from "express";
import { renderLoginPage } from "../settings/views";

// Hand-rolled per-IP sliding-window throttle for the login/migrate routes —
// intentionally in-memory (not persisted like the per-account lockout in
// db/users.ts), since only account-level lockout needs to survive a
// restart. Requires app.set("trust proxy", ...) upstream so req.ip reflects
// the real client through Caddy rather than its internal address.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 20;
const attempts = new Map<string, number[]>();

function prune(ip: string): number[] {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, list);
  return list;
}

export function recordFailedLoginAttempt(ip: string): void {
  const list = prune(ip);
  list.push(Date.now());
}

export function blockIfIpRateLimited(req: Request, res: Response, next: NextFunction): void {
  if (prune(req.ip ?? "unknown").length >= MAX_ATTEMPTS_PER_IP) {
    res.status(429).send(renderLoginPage("Too many login attempts from this network. Try again in a few minutes."));
    return;
  }
  next();
}
