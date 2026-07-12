import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getAuthState, verifyLegacyAdminPassword, clearLegacyAdminPassword, login, type AuthState } from "./auth";
import { createUser, listUsers, deleteUser } from "../db/users";
import { createBusiness, listBusinesses } from "../db/businesses";
import { requireAdminSession } from "../middleware/requireAdminSession";
import { blockIfIpRateLimited, recordFailedLoginAttempt } from "../middleware/loginRateLimiter";
import { renderSetupPage, renderLoginPage, renderMigratePage, renderBusinessListPage } from "./views";

declare module "express-session" {
  interface SessionData {
    flash?: { type: "success" | "error"; message: string };
  }
}

export const settingsRouter = Router();

const emailSchema = z.string().trim().toLowerCase().email();

function parseEmail(raw: string | undefined): string | null {
  const result = emailSchema.safeParse(raw ?? "");
  return result.success ? result.data : null;
}

// Every entry point redirects here first so a visitor always lands on the
// right step of setup → migrate → login, regardless of which URL they hit.
function redirectToAuthEntryPoint(res: Response, state: AuthState): void {
  if (state === "fresh") {
    res.redirect("/settings/setup");
  } else if (state === "needs_migration") {
    res.redirect("/settings/migrate");
  } else {
    res.redirect("/settings/login");
  }
}

function takeFlash(req: Request) {
  const flash = req.session.flash;
  req.session.flash = undefined;
  return flash;
}

settingsRouter.get("/setup", (req, res) => {
  const state = getAuthState();
  if (state !== "fresh") {
    redirectToAuthEntryPoint(res, state);
    return;
  }
  res.send(renderSetupPage());
});

settingsRouter.post("/setup", (req, res) => {
  const state = getAuthState();
  if (state !== "fresh") {
    redirectToAuthEntryPoint(res, state);
    return;
  }
  const { email: rawEmail, password, confirmPassword } = req.body as {
    email?: string;
    password?: string;
    confirmPassword?: string;
  };
  const email = parseEmail(rawEmail);
  if (!email) {
    res.send(renderSetupPage("Enter a valid email address."));
    return;
  }
  if (!password || password.length < 8 || password !== confirmPassword) {
    res.send(renderSetupPage("Password must be at least 8 characters and match confirmation."));
    return;
  }
  const user = createUser(email, password);
  req.session.userId = user.id;
  res.redirect("/settings");
});

// Only allow redirecting back to a same-site relative path — guards against
// an open redirect via a crafted returnTo value like "//evil.example.com".
function isSafeReturnPath(value: string | undefined): value is string {
  return !!value && value.startsWith("/") && !value.startsWith("//");
}

settingsRouter.get("/migrate", (req, res) => {
  const state = getAuthState();
  if (state !== "needs_migration") {
    redirectToAuthEntryPoint(res, state);
    return;
  }
  res.send(renderMigratePage());
});

settingsRouter.post("/migrate", blockIfIpRateLimited, (req, res) => {
  const state = getAuthState();
  if (state !== "needs_migration") {
    redirectToAuthEntryPoint(res, state);
    return;
  }
  const { currentPassword, email: rawEmail } = req.body as { currentPassword?: string; email?: string };
  const email = parseEmail(rawEmail);
  if (!email) {
    res.send(renderMigratePage("Enter a valid email address."));
    return;
  }
  if (!currentPassword || !verifyLegacyAdminPassword(currentPassword)) {
    recordFailedLoginAttempt(req.ip ?? "unknown");
    res.send(renderMigratePage("Incorrect current password."));
    return;
  }
  const user = createUser(email, currentPassword);
  clearLegacyAdminPassword();
  req.session.userId = user.id;
  res.redirect("/settings");
});

settingsRouter.get("/login", (req, res) => {
  const state = getAuthState();
  if (state !== "ready") {
    redirectToAuthEntryPoint(res, state);
    return;
  }
  const returnTo = req.query.returnTo;
  res.send(renderLoginPage(undefined, typeof returnTo === "string" ? returnTo : undefined));
});

settingsRouter.post("/login", blockIfIpRateLimited, (req, res) => {
  const state = getAuthState();
  if (state !== "ready") {
    redirectToAuthEntryPoint(res, state);
    return;
  }
  const { email, password, returnTo } = req.body as { email?: string; password?: string; returnTo?: string };
  const result = email && password ? login(email, password) : { ok: false as const };
  if (result.ok) {
    req.session.userId = result.user.id;
    res.redirect(isSafeReturnPath(returnTo) ? returnTo : "/settings");
    return;
  }
  recordFailedLoginAttempt(req.ip ?? "unknown");
  res.send(renderLoginPage("Invalid email or password.", returnTo));
});

settingsRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/settings/login");
  });
});

settingsRouter.get(
  "/",
  (req, res, next) => {
    const state = getAuthState();
    if (state !== "ready") {
      redirectToAuthEntryPoint(res, state);
      return;
    }
    next();
  },
  requireAdminSession,
  (req, res) => {
    const flash = takeFlash(req);
    res.send(
      renderBusinessListPage({
        businesses: listBusinesses(),
        users: listUsers(),
        currentUserId: req.session.userId!,
        flash,
      }),
    );
  },
);

settingsRouter.post("/businesses", requireAdminSession, (req, res) => {
  const { name } = req.body as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) {
    req.session.flash = { type: "error", message: "Enter a business name." };
    res.redirect("/settings");
    return;
  }
  const business = createBusiness(trimmed);
  res.redirect(`/b/${business.id}/settings`);
});

settingsRouter.post("/users", requireAdminSession, (req, res) => {
  const { email: rawEmail, password, confirmPassword } = req.body as {
    email?: string;
    password?: string;
    confirmPassword?: string;
  };
  const email = parseEmail(rawEmail);
  if (!email) {
    req.session.flash = { type: "error", message: "Enter a valid email address." };
    res.redirect("/settings");
    return;
  }
  if (!password || password.length < 8 || password !== confirmPassword) {
    req.session.flash = { type: "error", message: "Password must be at least 8 characters and match confirmation." };
    res.redirect("/settings");
    return;
  }
  try {
    createUser(email, password);
    req.session.flash = { type: "success", message: `Added user ${email}.` };
  } catch {
    req.session.flash = { type: "error", message: "That email is already in use." };
  }
  res.redirect("/settings");
});

settingsRouter.post("/users/:id/delete", requireAdminSession, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) {
    req.session.flash = { type: "error", message: "You cannot delete your own account." };
  } else {
    deleteUser(id);
    req.session.flash = { type: "success", message: "User removed." };
  }
  res.redirect("/settings");
});
