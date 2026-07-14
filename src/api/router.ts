import { Router } from "express";
import { requireApiSession } from "./requireApiSession";
import { listBusinesses } from "../db/businesses";
import { apiBusinessRouter } from "./businessRouter";

export const apiRouter = Router();

apiRouter.get("/session", requireApiSession, (req, res) => {
  res.json({ user: { id: req.currentUser!.id, email: req.currentUser!.email } });
});

apiRouter.get("/businesses", requireApiSession, (_req, res) => {
  res.json({ businesses: listBusinesses() });
});

apiRouter.use("/businesses/:businessId", apiBusinessRouter);
