import express from "express";
import session from "express-session";
import { env } from "./config/env";
import "./db/index";
import { requestLogger } from "./middleware/requestLogger";
import { settingsRouter } from "./settings/routes";
import { toolsRouter } from "./tools/router";
import { webhooksRouter } from "./webhooks/router";
import { dashboardRouter } from "./dashboard/routes";
import { SqliteSessionStore } from "./settings/sessionStore";
import { getOrCreateSessionSecret } from "./settings/store";

const app = express();

// Captures the raw request body alongside express's usual JSON parsing —
// needed to verify ElevenLabs' post-call webhook signature, which is
// computed over the exact raw bytes, not a re-serialized JSON object.
app.use(
  express.json({
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
app.use("/tools", toolsRouter);
app.use("/webhooks", webhooksRouter);
app.use(dashboardRouter);

app.listen(env.PORT, () => {
  console.log(`Voice agent platform listening on http://localhost:${env.PORT}`);
  console.log(`Open http://localhost:${env.PORT}/settings to configure credentials.`);
});
