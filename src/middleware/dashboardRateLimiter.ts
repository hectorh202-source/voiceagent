import type { NextFunction, Request, Response } from "express";

// Per-IP sliding-window throttles for the public, unauthenticated call-detail
// routes. Separate from loginRateLimiter.ts on purpose — this isn't part of
// the login/lockout system, and a real <audio> playback issues many
// legitimate Range sub-requests that shouldn't share a budget with page
// loads, so the HTML page and the audio stream get independent limits.
// These throttle scanning/noise and bound worst-case load — they are not
// the load-bearing defense against ID-guessing (the conversation ID's own
// entropy is), so the ceilings are generous rather than strict.
const WINDOW_MS = 5 * 60 * 1000;

function makeLimiter(maxPerWindow: number) {
  const hits = new Map<string, number[]>();
  return function limiter(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    if (recent.length > maxPerWindow) {
      res.status(429).send("Too many requests. Try again in a few minutes.");
      return;
    }
    next();
  };
}

export const limitCallPageRequests = makeLimiter(30);
export const limitCallAudioRequests = makeLimiter(300);
