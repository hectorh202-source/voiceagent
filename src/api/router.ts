import { Router } from "express";
import { requireApiSession } from "./requireApiSession";
import { listBusinessesForUser } from "../db/userBusinesses";
import { apiBusinessRouter } from "./businessRouter";

export const apiRouter = Router();

apiRouter.get("/session", requireApiSession, (req, res) => {
  res.json({ user: { id: req.currentUser!.id, email: req.currentUser!.email } });
});

// Scoped to whatever businesses this user actually has access to — a
// platform admin gets every business (listBusinessesForUser's own bypass),
// same as before this feature existed. The SPA's business switcher and
// FirstBusinessRedirect need no changes: both already just render whatever
// this returns.
apiRouter.get("/businesses", requireApiSession, (req, res) => {
  res.json({ businesses: listBusinessesForUser(req.currentUser!) });
});

apiRouter.use("/businesses/:businessId", apiBusinessRouter);
