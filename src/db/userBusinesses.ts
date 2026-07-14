import { db } from "./index";
import { getBusinessById, listBusinesses } from "./businesses";
import type { Business } from "./businesses";
import type { User } from "./users";

const getIdsStmt = db.prepare(`SELECT business_id FROM user_businesses WHERE user_id = ?`);
const deleteForUserStmt = db.prepare(`DELETE FROM user_businesses WHERE user_id = ?`);
const insertStmt = db.prepare(`INSERT INTO user_businesses (user_id, business_id) VALUES (?, ?)`);

export function getUserBusinessIds(userId: number): number[] {
  return (getIdsStmt.all(userId) as { business_id: number }[]).map((r) => r.business_id);
}

// Replace-all semantics — matches a checkbox-grid UI submitting the full
// desired set each time, rather than diffing individual add/remove.
export function setUserBusinesses(userId: number, businessIds: number[]): void {
  db.exec("BEGIN");
  try {
    deleteForUserStmt.run(userId);
    for (const businessId of businessIds) insertStmt.run(userId, businessId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Platform admins bypass membership entirely — they see every business,
// exactly like every user did before this feature existed.
export function listBusinessesForUser(user: User): Business[] {
  if (user.isPlatformAdmin) return listBusinesses();
  return getUserBusinessIds(user.id)
    .map((id) => getBusinessById(id))
    .filter((b): b is Business => !!b);
}

export function userHasBusinessAccess(user: User, businessId: number): boolean {
  if (user.isPlatformAdmin) return true;
  return getUserBusinessIds(user.id).includes(businessId);
}
