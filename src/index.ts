import express from "express";
import session from "express-session";
import { env } from "./config/env";
import "./db/index";
import { requestLogger } from "./middleware/requestLogger";
import { settingsRouter } from "./settings/routes";
import { toolsRouter } from "./tools/router";
import { SqliteSessionStore } from "./settings/sessionStore";
import { getOrCreateSessionSecret } from "./settings/store";

const app = express();

app.use(express.json());
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

app.listen(env.PORT, () => {
  console.log(`Voice agent platform listening on http://localhost:${env.PORT}`);
  console.log(`Open http://localhost:${env.PORT}/settings to configure credentials.`);
});
