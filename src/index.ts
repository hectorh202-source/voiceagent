import express, { Router } from "express";
import path from "node:path";
import session from "express-session";
import { env } from "./config/env";
import "./db/index";
import { requestLogger } from "./middleware/requestLogger";
import { securityHeaders } from "./middleware/securityHeaders";
import { verifyOrigin } from "./middleware/verifyOrigin";
import { noStore } from "./middleware/noStore";
import { settingsRouter } from "./settings/routes";
import { resolveBusiness } from "./middleware/resolveBusiness";
import { toolsRouter } from "./tools/router";
import { webhooksRouter } from "./webhooks/router";
import { widgetServiceRouter } from "./api/widgetServiceRouter";
import { dashboardRouter } from "./dashboard/routes";
import { apiRouter } from "./api/router";
import { SqliteSessionStore } from "./settings/sessionStore";
import { getOrCreateSessionSecret } from "./settings/store";
import { getUserById } from "./db/users";
import { userHasBusinessAccess } from "./db/userBusinesses";
import { pollAndStartRecordings } from "./twilio/pollCalls";
import { pollGoogleLsaLeads } from "./googleLsa/pollLeads";

const app = express();

// Trust exactly one hop (the Caddy reverse proxy) so req.ip reflects the
// real client address instead of Caddy's internal one — needed for the
// per-IP login rate limiter in middleware/loginRateLimiter.ts to work.
app.set("trust proxy", 1);

app.use(securityHeaders);

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
  res.redirect("/app");
});

app.use("/settings", verifyOrigin, noStore, settingsRouter);

// Mounted BEFORE (and outside) the verifyOrigin-guarded /api below, on
// purpose. This router is server-to-server — the standalone chat widget
// service calling in with a shared secret — so it carries no Origin/Referer
// at all, exactly like /b/:businessId/tools and /webhooks. verifyOrigin
// rejects any non-GET request without a matching Origin, which would 403
// every POST here (the config endpoint only escapes that by being a GET).
app.use("/api/widget-service", noStore, widgetServiceRouter);

app.use("/api", verifyOrigin, noStore, apiRouter);

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

// The 5 pre-session auth pages — reachable with no session at all, since
// requiring one would be a chicken-and-egg problem for the page that
// creates one. Checked before the session check below, not instead of it:
// an *already*-authenticated visitor hitting one of these still bounces
// forward to /app, generalizing what the old GET /login route did (see
// api/authRouter.ts's GET /state, which the pages themselves also check
// client-side as a second layer).
const PUBLIC_AUTH_PATHS = new Set(["login", "setup", "migrate", "forgot-password", "reset-password"]);

// A single, structural gate for the whole SPA shell — every /app/* HTML
// request passes through here before the file is ever sent, so a page added
// later inherits the right check automatically just by living at
// /app/admin or /app/:businessId/..., with no per-route code required (the
// old version of this only special-cased /app/admin by its exact path
// string, which meant a *different* future admin-only or business-scoped
// page would silently get none of this unless someone remembered to copy
// the same block again).
//
// Four cases, checked in order of how much they can rule out:
// 1. A public auth path (login/setup/migrate/forgot-password/reset-password)
//    — no session required; an already-logged-in visitor bounces to /app.
// 2. No valid session at all — redirect to the real login page. (Previously
//    nothing checked this; an anonymous visitor got a real 200 for any
//    /app/* URL and was only bounced after the SPA's JS loaded and
//    /api/session came back 401.)
// 3. /app/admin — requires isPlatformAdmin, same as requirePlatformAdmin
//    gates /settings.
// 4. /app/:businessId/... — requires userHasBusinessAccess() for that
//    specific business, the same check the JSON API already enforces via
//    requireBusinessAccess, just applied to the shell itself instead of
//    only the data underneath it.
function requireAppAccess(req: express.Request, res: express.Response, next: express.NextFunction): void {
  // req.params[0] is whatever "/app/*" matched — e.g. "admin", "1/calls",
  // "1/admin" (a business's own admin console), "login", or "" for a bare
  // /app request (FirstBusinessRedirect, needs nothing beyond "is there a
  // session"). Parsed before the session check below so the public-path
  // allowlist can skip that check entirely for these 5 paths.
  const [first, second] = (req.params[0] ?? "").split("/").filter(Boolean);

  const user = req.session.userId ? getUserById(req.session.userId) : undefined;

  if (PUBLIC_AUTH_PATHS.has(first)) {
    if (user) {
      res.redirect("/app");
      return;
    }
    next();
    return;
  }

  if (!user) {
    const returnTo = encodeURIComponent(req.originalUrl);
    res.redirect(`/app/login?returnTo=${returnTo}`);
    return;
  }

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

// See twilio/pollCalls.ts for why this exists — Twilio's own phone-number
// status callback can't tell us a call is in progress early enough to start
// recording it, so this checks directly on a timer instead. Isolated from
// the live call-answering path entirely; a failure here only affects
// whether a recording gets captured, never the call itself.
setInterval(() => {
  pollAndStartRecordings().catch((error) => console.error("Twilio recording poll failed:", error));
}, 10_000);

// See googleLsa/pollLeads.ts — Google's Local Services Ads API is poll-based
// (no true webhook), so this checks every linked business's account on a
// timer and writes any new/updated leads into the Leads inbox. No-ops for
// any business that hasn't configured Google Ads credentials yet.
setInterval(() => {
  pollGoogleLsaLeads().catch((error) => console.error("Google LSA poll failed:", error));
}, 5 * 60_000);
