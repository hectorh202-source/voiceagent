import type { User } from "../db/users";
import type { Business } from "../db/businesses";

declare global {
  namespace Express {
    interface Request {
      currentUser?: User;
      business?: Business;
    }
  }
}

// Moved here from middleware/requireAdminSession.ts when that file was
// deleted (the pre-session auth pages folded into the SPA, see
// api/authRouter.ts) — this augmentation is a global side effect of
// importing the file it lives in, so it needs a home that's guaranteed to
// always be part of the compiled program rather than living inside whatever
// one route handler happened to need it first.
declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

export {};
