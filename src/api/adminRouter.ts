import { Router } from "express";
import { z } from "zod";
import { requireApiSession } from "./requireApiSession";
import { requireApiPlatformAdmin } from "./requireApiPlatformAdmin";
import { createBusiness, listBusinesses } from "../db/businesses";
import { createUser, listUsers, deleteUser, setPlatformAdmin } from "../db/users";
import { getUserBusinessIds, setUserBusinesses } from "../db/userBusinesses";

// The JSON counterpart of the global, server-rendered /settings business/user
// console (src/settings/routes.ts) — same underlying db functions, just
// returning JSON instead of redirecting/rendering HTML, so the React SPA's
// Admin Settings page can drive the same actions in-app. Every route here is
// platform-admin-only; a non-admin session gets a 403, same as
// apiBusinessRouter's requireBusinessAccess does for business-scoped routes.
export const adminRouter = Router();

adminRouter.use(requireApiSession);
adminRouter.use(requireApiPlatformAdmin);

adminRouter.get("/businesses", (_req, res) => {
  res.json({ businesses: listBusinesses() });
});

const createBusinessSchema = z.object({ name: z.string().trim().min(1) });

adminRouter.post("/businesses", (req, res) => {
  const parsed = createBusinessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a business name." });
    return;
  }
  const business = createBusiness(parsed.data.name);
  res.json({ business });
});

adminRouter.get("/users", (_req, res) => {
  const users = listUsers();
  res.json({
    users: users.map((u) => ({ ...u, businessIds: getUserBusinessIds(u.id) })),
  });
});

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  isPlatformAdmin: z.boolean().optional().default(false),
  businessIds: z.array(z.number().int()).optional().default([]),
});

adminRouter.post("/users", (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and an 8+ character password.", details: parsed.error.flatten() });
    return;
  }
  const { email, password, isPlatformAdmin, businessIds } = parsed.data;
  try {
    const user = createUser(email, password, isPlatformAdmin);
    if (!isPlatformAdmin) setUserBusinesses(user.id, businessIds);
    res.json({ success: true });
  } catch {
    res.status(409).json({ error: "That email is already in use." });
  }
});

const accessSchema = z.object({
  isPlatformAdmin: z.boolean().optional().default(false),
  businessIds: z.array(z.number().int()).optional().default([]),
});

adminRouter.post("/users/:id/access", (req, res) => {
  const id = Number(req.params.id);
  const parsed = accessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  // Mirrors the equivalent guard in settings/routes.ts — revoking your own
  // admin access here could lock you out of this console entirely with no
  // one else able to restore it.
  if (id === req.currentUser!.id && !parsed.data.isPlatformAdmin) {
    res.status(400).json({ error: "You cannot remove your own platform admin access." });
    return;
  }
  setPlatformAdmin(id, parsed.data.isPlatformAdmin);
  setUserBusinesses(id, parsed.data.isPlatformAdmin ? [] : parsed.data.businessIds);
  res.json({ success: true });
});

adminRouter.delete("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.currentUser!.id) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }
  deleteUser(id);
  res.json({ success: true });
});
