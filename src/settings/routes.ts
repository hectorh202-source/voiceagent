import { Router, type Request } from "express";
import crypto from "node:crypto";
import { isAdminPasswordSet, setAdminPassword, verifyAdminPassword } from "./auth";
import {
  getElevenLabsConfig,
  setElevenLabsConfig,
  getServiceTitanConfig,
  setServiceTitanConfig,
  getOperationalConfig,
  setOperationalConfig,
  getSetting,
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
        elevenLabs: getElevenLabsConfig(),
        serviceTitan: getServiceTitanConfig(),
        operational: getOperationalConfig(),
        environment: (getSetting("servicetitan.environment") as ServiceTitanEnvironment | null) ?? "integration",
        flash,
      }),
    );
  },
);

settingsRouter.post("/", requireAdminSession, (req, res) => {
  const body = req.body as Record<string, string | undefined>;

  const currentEl = getElevenLabsConfig();
  setElevenLabsConfig({
    apiKey: body.elevenLabsApiKey?.trim() || currentEl?.apiKey || "",
    agentId: body.elevenLabsAgentId?.trim() || currentEl?.agentId || "",
  });

  const currentSt = getServiceTitanConfig();
  setServiceTitanConfig({
    environment: (body.serviceTitanEnvironment as ServiceTitanEnvironment) || "integration",
    clientId: body.serviceTitanClientId?.trim() || currentSt?.clientId || "",
    clientSecret: body.serviceTitanClientSecret?.trim() || currentSt?.clientSecret || "",
    appKey: body.serviceTitanAppKey?.trim() || currentSt?.appKey || "",
    tenantId: body.serviceTitanTenantId?.trim() || currentSt?.tenantId || "",
    defaultBusinessUnitId: body.serviceTitanBusinessUnitId?.trim() ?? currentSt?.defaultBusinessUnitId ?? "",
    defaultCampaignId: body.serviceTitanCampaignId?.trim() ?? currentSt?.defaultCampaignId ?? "",
    defaultCallReasonId: body.serviceTitanCallReasonId?.trim() ?? currentSt?.defaultCallReasonId ?? "",
    defaultJobTypeId: body.serviceTitanJobTypeId?.trim() ?? currentSt?.defaultJobTypeId ?? "",
  });

  const currentOp = getOperationalConfig();
  setOperationalConfig({
    emergencyTransferNumber: body.emergencyTransferNumber?.trim() || currentOp?.emergencyTransferNumber || "",
    toolWebhookSecret: body.toolWebhookSecret?.trim() || currentOp?.toolWebhookSecret || "",
  });

  req.session.flash = { type: "success", message: "Settings saved." };
  res.redirect("/settings");
});

settingsRouter.post("/generate-secret", requireAdminSession, (req, res) => {
  const secret = crypto.randomBytes(24).toString("hex");
  const current = getOperationalConfig();
  setOperationalConfig({
    emergencyTransferNumber: current?.emergencyTransferNumber || "",
    toolWebhookSecret: secret,
  });
  req.session.flash = {
    type: "success",
    message: `New tool webhook secret: ${secret} — copy it into ElevenLabs now, it will be masked after you leave this page.`,
  };
  res.redirect("/settings");
});
