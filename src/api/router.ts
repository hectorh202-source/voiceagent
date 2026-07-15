import { Router } from "express";
import { requireApiSession } from "./requireApiSession";
import { listBusinessesForUser } from "../db/userBusinesses";
import { apiBusinessRouter } from "./businessRouter";
import { adminRouter } from "./adminRouter";
import { authRouter } from "./authRouter";

export const apiRouter = Router();

// No requireApiSession here — every route on this router is meant to work
// without an existing session (that's the whole point of a pre-session auth
// flow), including logout, which no-ops harmlessly if no session exists.
apiRouter.use("/auth", authRouter);

apiRouter.get("/session", requireApiSession, (req, res) => {
  res.json({
    user: {
      id: req.currentUser!.id,
      email: req.currentUser!.email,
      isPlatformAdmin: req.currentUser!.isPlatformAdmin,
    },
  });
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
apiRouter.use("/admin", adminRouter);
