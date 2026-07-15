import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { BFCACHE_RELOAD_SCRIPT } from "../settings/views";

// The only inline <script> anywhere in the app (the auth pages' bfcache-
// reload script) — hashed here instead of relaxing script-src to
// 'unsafe-inline', which would defeat most of the point of a CSP. Computed
// from the same exported constant that's actually rendered into the page,
// so this can never silently drift out of sync with the real script text.
const inlineScriptHash = crypto.createHash("sha256").update(BFCACHE_RELOAD_SCRIPT, "utf8").digest("base64");

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'sha256-${inlineScriptHash}'`,
  // 'unsafe-inline' is needed here: the React client renders inline
  // style={{}} attributes throughout, and the server-rendered auth pages
  // have one inline <style> block. Nothing else in the app needs it.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Applied app-wide, first in the middleware chain. Individual routers (e.g.
// dashboard/routes.ts) may still set their own additional/stricter headers
// afterward — since res.setHeader replaces rather than appends, a more
// specific value set later in the chain wins for that router's routes.
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Browsers ignore this header entirely over a plain http:// connection, so
  // it's safe to always send — it only takes effect once Caddy's HTTPS is
  // actually in front of a request.
  res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
  next();
}
