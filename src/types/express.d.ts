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

export {};
