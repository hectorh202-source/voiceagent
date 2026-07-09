import express from "express";
import session from "express-session";
import crypto from "node:crypto";
import { env } from "./config/env";
import "./db/index";
import { requestLogger } from "./middleware/requestLogger";
import { settingsRouter } from "./settings/routes";
import { toolsRouter } from "./tools/router";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.use(
  session({
    secret: crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
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
