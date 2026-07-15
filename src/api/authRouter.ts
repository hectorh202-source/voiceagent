import { Router } from "express";
import { z } from "zod";
import { getAuthState, verifyLegacyAdminPassword, clearLegacyAdminPassword, login } from "../settings/auth";
import { createUser, getUserById, getUserByEmail, setPassword } from "../db/users";
import { createPasswordResetToken, isValidResetToken, consumeResetToken } from "../db/passwordResetTokens";
import { sendPasswordResetEmail } from "../settings/email";
import { isLoginRateLimited, recordFailedLoginAttempt, isForgotPasswordRateLimited, recordForgotPasswordRequest } from "../middleware/loginRateLimiter";

export const authRouter = Router();

const emailSchema = z.string().trim().toLowerCase().email();
function parseEmail(raw: unknown): string | null {
  const result = emailSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// The SPA's single bootstrap call for every pre-session page — replaces
// both getAuthState()'s server-side dispatch (fresh/needs_migration/ready)
// and the old GET /login "already logged in? bounce to /app" check, now
// generalized to all 5 public auth pages instead of just login.
authRouter.get("/state", (req, res) => {
  const state = getAuthState();
  const authenticated = state === "ready" && !!req.session.userId && !!getUserById(req.session.userId);
  res.json({ state, authenticated });
});

authRouter.post("/setup", (req, res) => {
  const state = getAuthState();
  if (state !== "fresh") {
    res.status(409).json({ error: "not_fresh", state });
    return;
  }
  const { email: rawEmail, password, confirmPassword } = req.body as {
    email?: string;
    password?: string;
    confirmPassword?: string;
  };
  const email = parseEmail(rawEmail);
  if (!email) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (!password || password.length < 8 || password !== confirmPassword) {
    res.status(400).json({ error: "Password must be at least 8 characters and match confirmation." });
    return;
  }
  // The very first account is always a platform admin — there's no one else
  // yet who could grant them access to anything.
  const user = createUser(email, password, true);
  req.session.userId = user.id;
  res.json({ success: true });
});

authRouter.post("/migrate", (req, res) => {
  const state = getAuthState();
  if (state !== "needs_migration") {
    res.status(409).json({ error: "not_needs_migration", state });
    return;
  }
  const ip = req.ip ?? "unknown";
  if (isLoginRateLimited(ip)) {
    res.status(429).json({ error: "Too many attempts from this network. Try again in a few minutes." });
    return;
  }
  const { currentPassword, email: rawEmail } = req.body as { currentPassword?: string; email?: string };
  const email = parseEmail(rawEmail);
  if (!email) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (!currentPassword || !verifyLegacyAdminPassword(currentPassword)) {
    recordFailedLoginAttempt(ip);
    res.status(401).json({ error: "Incorrect current password." });
    return;
  }
  // Same reasoning as /setup — this migrated account was the sole admin
  // under the old single-password model, so it keeps full access.
  const user = createUser(email, currentPassword, true);
  clearLegacyAdminPassword();
  req.session.userId = user.id;
  res.json({ success: true });
});

authRouter.post("/login", (req, res) => {
  const state = getAuthState();
  if (state !== "ready") {
    res.status(409).json({ error: "not_ready", state });
    return;
  }
  const ip = req.ip ?? "unknown";
  if (isLoginRateLimited(ip)) {
    res.status(429).json({ error: "Too many login attempts from this network. Try again in a few minutes." });
    return;
  }
  const { email, password } = req.body as { email?: string; password?: string };
  const result = email && password ? login(email, password) : { ok: false as const };
  if (result.ok) {
    req.session.userId = result.user.id;
    res.json({ success: true });
    return;
  }
  recordFailedLoginAttempt(ip);
  res.status(401).json({ error: "Invalid email or password." });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

authRouter.post("/forgot-password", async (req, res) => {
  const state = getAuthState();
  if (state !== "ready") {
    res.status(409).json({ error: "not_ready", state });
    return;
  }
  const ip = req.ip ?? "unknown";
  if (isForgotPasswordRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests from this network. Try again in a few minutes." });
    return;
  }
  recordForgotPasswordRequest(ip);

  const { email: rawEmail } = req.body as { email?: string };
  const email = parseEmail(rawEmail);
  if (!email) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }

  // Always the identical success response below regardless of whether this
  // email actually matches an account, or whether sending even succeeded —
  // anything that varies the response here would let an attacker enumerate
  // which emails have accounts on this deployment.
  const user = getUserByEmail(email);
  if (user) {
    try {
      const token = createPasswordResetToken(user.id);
      const resetUrl = `${req.protocol}://${req.get("host")}/app/reset-password?token=${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      console.error("Failed to send password reset email:", err);
    }
  }

  res.json({ message: "If an account exists for that email, we've sent a password reset link. It expires in 1 hour." });
});

authRouter.get("/reset-password", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  res.json({ valid: !!token && isValidResetToken(token) });
});

authRouter.post("/reset-password", (req, res) => {
  const { token, password, confirmPassword } = req.body as {
    token?: string;
    password?: string;
    confirmPassword?: string;
  };
  if (!token) {
    res.status(400).json({ error: "This link is invalid or expired. Request a new one." });
    return;
  }
  if (!password || password.length < 8 || password !== confirmPassword) {
    res.status(400).json({ error: "Password must be at least 8 characters and match confirmation." });
    return;
  }
  // Consuming (not just validating) here — this is the one real state
  // change, so the token must become unusable the moment it's spent, same
  // as any other single-use credential.
  const userId = consumeResetToken(token);
  if (!userId) {
    res.status(400).json({ error: "This link is invalid or expired. Request a new one." });
    return;
  }
  setPassword(userId, password);
  req.session.userId = userId;
  res.json({ success: true });
});
