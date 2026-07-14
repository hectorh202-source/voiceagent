import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getAuthState, verifyLegacyAdminPassword, clearLegacyAdminPassword, login, type AuthState } from "./auth";
import { createUser, listUsers, deleteUser, setPlatformAdmin } from "../db/users";
import { createBusiness, listBusinesses } from "../db/businesses";
import { getUserBusinessIds, setUserBusinesses } from "../db/userBusinesses";
import { requireAdminSession } from "../middleware/requireAdminSession";
import { requirePlatformAdmin } from "../middleware/requirePlatformAdmin";
import { blockIfIpRateLimited, recordFailedLoginAttempt } from "../middleware/loginRateLimiter";
import { renderSetupPage, renderLoginPage, renderMigratePage, renderBusinessListPage } from "./views";

// Checkbox arrays submit as a single string when only one is checked, an
// array when multiple are — normalize to always an array of numbers.
function parseBusinessIds(raw: string | string[] | undefined): number[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map(Number).filter((n) => Number.isInteger(n));
}

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
  (req, res) => {
    const flash = takeFlash(req);
    const users = listUsers();
    res.send(
      renderBusinessListPage({
        businesses: listBusinesses(),
        users,
        userBusinessIds: Object.fromEntries(users.map((u) => [u.id, getUserBusinessIds(u.id)])),
        currentUserId: req.session.userId!,
        flash,
      }),
    );
  },
);

settingsRouter.post("/businesses", requireAdminSession, requirePlatformAdmin, (req, res) => {
  const { name } = req.body as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) {
    req.session.flash = { type: "error", message: "Enter a business name." };
    res.redirect("/settings");
    return;
  }
  const business = createBusiness(trimmed);
  // Platform admins (the only ones who can reach this route) see every
  // business regardless of user_businesses — no membership row needed here.
  res.redirect(`/app/${business.id}/settings/business-info`);
});

settingsRouter.post("/users", requireAdminSession, requirePlatformAdmin, (req, res) => {
  const { email: rawEmail, password, confirmPassword, isPlatformAdmin, businessIds } = req.body as {
    email?: string;
    password?: string;
    confirmPassword?: string;
    isPlatformAdmin?: string;
    businessIds?: string | string[];
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
  const admin = isPlatformAdmin === "on";
  try {
    const user = createUser(email, password, admin);
    if (!admin) setUserBusinesses(user.id, parseBusinessIds(businessIds));
    req.session.flash = { type: "success", message: `Added user ${email}.` };
  } catch {
    req.session.flash = { type: "error", message: "That email is already in use." };
  }
  res.redirect("/settings");
});

settingsRouter.post("/users/:id/access", requireAdminSession, requirePlatformAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { isPlatformAdmin, businessIds } = req.body as { isPlatformAdmin?: string; businessIds?: string | string[] };
  const admin = isPlatformAdmin === "on";
  if (id === req.session.userId && !admin) {
    // Mirrors the "can't delete your own account" guard below — revoking
    // your own admin access here could lock you out of the console entirely
    // with no one else able to restore it.
    req.session.flash = { type: "error", message: "You cannot remove your own platform admin access." };
    res.redirect("/settings");
    return;
  }
  setPlatformAdmin(id, admin);
  setUserBusinesses(id, admin ? [] : parseBusinessIds(businessIds));
  req.session.flash = { type: "success", message: "Access updated." };
  res.redirect("/settings");
});

settingsRouter.post("/users/:id/delete", requireAdminSession, requirePlatformAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) {
    req.session.flash = { type: "error", message: "You cannot delete your own account." };
  } else {
    deleteUser(id);
    req.session.flash = { type: "success", message: "User removed." };
  }
  res.redirect("/settings");
});
