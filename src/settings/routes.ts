import { Router, type Request } from "express";
import crypto from "node:crypto";
import { isAdminPasswordSet, setAdminPassword, verifyAdminPassword } from "./auth";
import {
  setSetting,
  getRawElevenLabsSettings,
  getRawServiceTitanSettings,
  getRawOperationalSettings,
  type ServiceTitanEnvironment,
} from "./store";
import { requireAdminSession } from "../middleware/requireAdminSession";
import { renderSetupPage, renderLoginPage, renderSettingsPage } from "./views";

declare module "express-session" {
  interface SessionData {
    flash?: { type: "success" | "error"; message: string };
  }
}

export const settingsRouter = Router();

function takeFlash(req: Request) {
  const flash = req.session.flash;
  req.session.flash = undefined;
  return flash;
}

// Saves a field only if a non-blank value was submitted, otherwise leaves
// whatever's already stored untouched (used for the "leave blank to keep
// current" behavior on every settings field, secret or not).
function maybeSet(key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    setSetting(key, trimmed);
  }
}

settingsRouter.get("/setup", (req, res) => {
  if (isAdminPasswordSet()) {
    res.redirect("/settings/login");
    return;
  }
  res.send(renderSetupPage());
});

settingsRouter.post("/setup", (req, res) => {
  if (isAdminPasswordSet()) {
    res.redirect("/settings/login");
    return;
  }
  const { password, confirmPassword } = req.body as { password?: string; confirmPassword?: string };
  if (!password || password.length < 8 || password !== confirmPassword) {
    res.send(renderSetupPage("Password must be at least 8 characters and match confirmation."));
    return;
  }
  setAdminPassword(password);
  req.session.isAdmin = true;
  res.redirect("/settings");
});

settingsRouter.get("/login", (req, res) => {
  if (!isAdminPasswordSet()) {
    res.redirect("/settings/setup");
    return;
  }
  res.send(renderLoginPage());
});

settingsRouter.post("/login", (req, res) => {
  const { password } = req.body as { password?: string };
  if (password && verifyAdminPassword(password)) {
    req.session.isAdmin = true;
    res.redirect("/settings");
    return;
  }
  res.send(renderLoginPage("Incorrect password."));
});

settingsRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/settings/login");
  });
});

settingsRouter.get(
  "/",
  (req, res, next) => {
    if (!isAdminPasswordSet()) {
      res.redirect("/settings/setup");
      return;
    }
    next();
  },
  requireAdminSession,
  (req, res) => {
    const flash = takeFlash(req);
    res.send(
      renderSettingsPage({
        elevenLabs: getRawElevenLabsSettings(),
        serviceTitan: getRawServiceTitanSettings(),
        operational: getRawOperationalSettings(),
        flash,
      }),
    );
  },
);

settingsRouter.post("/", requireAdminSession, (req, res) => {
  const body = req.body as Record<string, string | undefined>;

  maybeSet("elevenlabs.apiKey", body.elevenLabsApiKey);
  maybeSet("elevenlabs.agentId", body.elevenLabsAgentId);

  setSetting("servicetitan.environment", (body.serviceTitanEnvironment as ServiceTitanEnvironment) || "integration");
  maybeSet("servicetitan.clientId", body.serviceTitanClientId);
  maybeSet("servicetitan.clientSecret", body.serviceTitanClientSecret);
  maybeSet("servicetitan.appKey", body.serviceTitanAppKey);
  maybeSet("servicetitan.tenantId", body.serviceTitanTenantId);
  maybeSet("servicetitan.businessUnitId", body.serviceTitanBusinessUnitId);
  maybeSet("servicetitan.campaignId", body.serviceTitanCampaignId);
  maybeSet("servicetitan.callReasonId", body.serviceTitanCallReasonId);
  maybeSet("servicetitan.jobTypeId", body.serviceTitanJobTypeId);
  maybeSet("servicetitan.tagName", body.serviceTitanTagName);

  maybeSet("operational.emergencyTransferNumber", body.emergencyTransferNumber);
  maybeSet("operational.toolWebhookSecret", body.toolWebhookSecret);

  req.session.flash = { type: "success", message: "Settings saved." };
  res.redirect("/settings");
});

settingsRouter.post("/generate-secret", requireAdminSession, (req, res) => {
  const secret = crypto.randomBytes(24).toString("hex");
  setSetting("operational.toolWebhookSecret", secret);
  req.session.flash = {
    type: "success",
    message: `New tool webhook secret: ${secret} — copy it into ElevenLabs now, it will be masked after you leave this page.`,
  };
  res.redirect("/settings");
});
