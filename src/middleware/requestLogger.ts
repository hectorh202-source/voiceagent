import type { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${durationMs}ms)`);
  });
  next();
}
