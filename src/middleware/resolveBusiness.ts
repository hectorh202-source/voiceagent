import type { NextFunction, Request, Response } from "express";
import { getBusinessById } from "../db/businesses";

// Resolves the :businessId URL segment into a real business, or 404s
// immediately. Must run before requireAdminSession/verifyToolSecret/the
// dashboard rate limiter on every business-scoped route — none of those can
// meaningfully answer "is this the right secret/session" without first
// knowing which business's scope applies, and an invalid business ID should
// 404 cleanly rather than surface a confusing 401/503 for a business that
// doesn't exist.
export function resolveBusiness(req: Request, res: Response, next: NextFunction): void {
  const id = Number(req.params.businessId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).send("Not found");
    return;
  }
  const business = getBusinessById(id);
  if (!business) {
    res.status(404).send("Not found");
    return;
  }
  req.business = business;
  next();
}
