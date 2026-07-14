import express, { Router } from "express";
import path from "node:path";
import session from "express-session";
import { env } from "./config/env";
import "./db/index";
import { requestLogger } from "./middleware/requestLogger";
import { settingsRouter } from "./settings/routes";
import { resolveBusiness } from "./middleware/resolveBusiness";
import { toolsRouter } from "./tools/router";
import { webhooksRouter } from "./webhooks/router";
import { dashboardRouter } from "./dashboard/routes";
import { apiRouter } from "./api/router";
import { SqliteSessionStore } from "./settings/sessionStore";
import { getOrCreateSessionSecret } from "./settings/store";

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

app.use("/settings", settingsRouter);
app.use("/api", apiRouter);

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
app.use("/app", express.static(clientDistPath));
app.get("/app/*", (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.listen(env.PORT, () => {
  console.log(`Voice agent platform listening on port ${env.PORT}`);
  console.log(`Visit /settings on this server's domain (or http://localhost:${env.PORT}/settings if running locally) to configure credentials.`);
});
