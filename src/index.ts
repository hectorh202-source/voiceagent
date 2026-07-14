import express, { Router } from "express";
import path from "node:path";
import session from "express-session";
import { env } from "./config/env";
import "./db/index";
import { requestLogger } from "./middleware/requestLogger";
import { noStore } from "./middleware/noStore";
import { settingsRouter } from "./settings/routes";
import { resolveBusiness } from "./middleware/resolveBusiness";
import { toolsRouter } from "./tools/router";
import { webhooksRouter } from "./webhooks/router";
import { dashboardRouter } from "./dashboard/routes";
import { apiRouter } from "./api/router";
import { SqliteSessionStore } from "./settings/sessionStore";
import { getOrCreateSessionSecret } from "./settings/store";
import { getUserById } from "./db/users";
import { userHasBusinessAccess } from "./db/userBusinesses";

const app = express();

// Trust exactly one hop (the Caddy reverse proxy) so req.ip reflects the
// real client address instead of Caddy's internal one — needed for the
// per-IP login rate limiter in middleware/loginRateLimiter.ts to work.
app.set("trust proxy", 1);

// Captures the raw request body alongside express's usual JSON parsing —
// needed to verify ElevenLabs' post-call webhook signature, which is
// computed over the exact raw bytes, not a re-serialized JSON object.
//
// The 50mb limit matters specifically for the post-call audio webhook: a
// full call's recording arrives base64-encoded inside the JSON body, and
// express's 100kb default silently rejected anything longer than a few
// seconds of audio — short test calls worked, real-length calls didn't.
app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.use(
  session({
    store: new SqliteSessionStore(),
    secret: getOrCreateSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 },
  }),
);

app.get("/", (_req, res) => {
  res.redirect("/settings");
});

app.use("/settings", noStore, settingsRouter);
app.use("/api", noStore, apiRouter);

// Every business-scoped concern (ElevenLabs tool webhooks, the post-call
// webhook, and the public per-call dashboard) lives under /b/:businessId —
// resolveBusiness runs first for all of them, 404ing immediately on an
// invalid/nonexistent business before any of the downstream auth/secret
// checks even run. Business-scoped credentials/settings now live in the
// React SPA (/app/:businessId/settings/*) via /api instead of a server-
// rendered form here.
// mergeParams: true is required here — without it, this child router gets
// its own fresh req.params scope and never sees :businessId from the parent
// mount path, so resolveBusiness would always see an empty req.params.
const businessRouter = Router({ mergeParams: true });
businessRouter.use(resolveBusiness);
businessRouter.use("/tools", toolsRouter);
businessRouter.use("/webhooks", webhooksRouter);
businessRouter.use(dashboardRouter);
app.use("/b/:businessId", businessRouter);

// The React SPA (client/) — built separately (see client/package.json's
// build script) and served as static assets. The GET /app/* catch-all lets
// React Router handle client-side routes like /app/1/calls/:conversationId
// on a hard refresh, where there's no matching file on disk.
const clientDistPath = path.join(__dirname, "../client/dist");
// index: false is required here — express.static's default behavior serves
// index.html directly for a bare "/app" request (its normal directory-index
// convenience), which would bypass the noStore catch-all below entirely.
// Confirmed via a real request: without this, GET /app came back with
// "Cache-Control: public, max-age=0" instead of "no-store", the exact HTML
// shell a browser's back-button needs to be blocked from resurrecting.
app.use("/app", express.static(clientDistPath, { index: false }));

// A single, structural gate for the whole SPA shell — every /app/* HTML
// request passes through here before the file is ever sent, so a page added
// later inherits the right check automatically just by living at
// /app/admin or /app/:businessId/..., with no per-route code required (the
// old version of this only special-cased /app/admin by its exact path
// string, which meant a *different* future admin-only or business-scoped
// page would silently get none of this unless someone remembered to copy
// the same block again).
//
// Three cases, checked in order of how much they can rule out:
// 1. No valid session at all — redirect to the real login page. (Previously
//    nothing checked this; an anonymous visitor got a real 200 for any
//    /app/* URL and was only bounced after the SPA's JS loaded and
//    /api/session came back 401.)
// 2. /app/admin — requires isPlatformAdmin, same as requirePlatformAdmin
//    gates /settings.
// 3. /app/:businessId/... — requires userHasBusinessAccess() for that
//    specific business, the same check the JSON API already enforces via
//    requireBusinessAccess, just applied to the shell itself instead of
//    only the data underneath it.
function requireAppAccess(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const user = req.session.userId ? getUserById(req.session.userId) : undefined;
  if (!user) {
    const returnTo = encodeURIComponent(req.originalUrl);
    res.redirect(`/settings/login?returnTo=${returnTo}`);
    return;
  }

  // req.params[0] is whatever "/app/*" matched — e.g. "admin", "1/calls",
  // "1/admin" (a business's own admin console), or "" for a bare /app
  // request (FirstBusinessRedirect, needs nothing beyond "is there a
  // session").
  const [first, second] = (req.params[0] ?? "").split("/").filter(Boolean);

  if (first === "admin") {
    if (!user.isPlatformAdmin) {
      res.redirect("/app");
      return;
    }
  } else if (first !== undefined) {
    const businessId = Number(first);
    if (Number.isInteger(businessId) && businessId > 0) {
      if (!userHasBusinessAccess(user, businessId)) {
        res.redirect("/app");
        return;
      }
      // /app/:businessId/admin is that business's own admin console — same
      // isPlatformAdmin requirement as the global /app/admin, just nested.
      // Business access alone (checked above) isn't enough here.
      if (second === "admin" && !user.isPlatformAdmin) {
        res.redirect("/app");
        return;
      }
    }
  }

  next();
}

// noStore here (not on the static mount above, whose JS/CSS filenames are
// content-hashed by Vite and safe to cache normally) — the shell itself must
// never come from cache/bfcache: it's what the browser's back-button would
// otherwise resurrect after a user switch, well before React ever gets a
// chance to re-check /api/session.
app.get("/app/*", noStore, requireAppAccess, (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.listen(env.PORT, () => {
  console.log(`Voice agent platform listening on port ${env.PORT}`);
  console.log(`Visit /settings on this server's domain (or http://localhost:${env.PORT}/settings if running locally) to configure credentials.`);
});
