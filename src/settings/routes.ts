import { Router, type Response } from "express";
import { z } from "zod";
import { getAuthState, verifyLegacyAdminPassword, clearLegacyAdminPassword, login, type AuthState } from "./auth";
import { createUser } from "../db/users";
import { requireAdminSession } from "../middleware/requireAdminSession";
import { requirePlatformAdmin } from "../middleware/requirePlatformAdmin";
import { blockIfIpRateLimited, recordFailedLoginAttempt } from "../middleware/loginRateLimiter";
import { renderSetupPage, renderLoginPage, renderMigratePage } from "./views";

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
  // The very first account is always a platform admin — there's no one else
  // yet who could grant them access to anything.
  const user = createUser(email, password, true);
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
  // Same reasoning as /setup — this migrated account was the sole admin
  // under the old single-password model, so it keeps full access.
  const user = createUser(email, currentPassword, true);
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

// The business/user management console itself now lives entirely in the
// React SPA (client/src/pages/AdminSettingsPage.tsx, /app/admin, backed by
// src/api/adminRouter.ts) — this route is just the post-login landing
// dispatcher: authenticated platform admins land in the SPA's admin
// console, everyone else (a scoped, non-admin user hitting /settings
// directly) gets bounced to /app, same as requirePlatformAdmin already does
// for every other server-rendered admin route.
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
  requirePlatformAdmin,
  (_req, res) => {
    res.redirect("/app/admin");
  },
);
