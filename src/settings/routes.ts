import { Router } from "express";

export const settingsRouter = Router();

// Every pre-session auth page (setup/migrate/login/forgot-password/
// reset-password) now lives in the React SPA, backed by src/api/authRouter.ts
// — these routes exist purely to keep old bookmarked/emailed URLs working
// during the transition. 302 (not 301) deliberately: a 301 could get cached
// indefinitely by a browser or Caddy, which would be awkward to walk back
// once these redirects themselves get deleted later. The query string is
// forwarded verbatim in every case — critical for /reset-password?token=...,
// since a real password-reset email sent before this deploy (1-hour TTL)
// must still work.
function redirectToApp(path: string) {
  return (req: import("express").Request, res: import("express").Response) => {
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    res.redirect(302, `/app${path}${query}`);
  };
}

settingsRouter.get("/setup", redirectToApp("/setup"));
settingsRouter.get("/migrate", redirectToApp("/migrate"));
settingsRouter.get("/login", redirectToApp("/login"));
settingsRouter.get("/forgot-password", redirectToApp("/forgot-password"));
settingsRouter.get("/reset-password", redirectToApp("/reset-password"));
settingsRouter.get("/", redirectToApp(""));
