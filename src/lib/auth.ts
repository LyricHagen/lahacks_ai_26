import "server-only";
// Who is making this request. getSessionUser() is the only way server code learns that.
// The session cookie holds just the user id; the role and status come from the database, so a
// decision an admin makes applies on the user's very next request.

import { eq } from "drizzle-orm";
import { unstable_rethrow } from "next/navigation";
import { redirect } from "next/navigation";
import { q } from "@/db";
import * as t from "@/db/schema";
import { auth } from "./auth-config";
import { AppError } from "./errors";
import { createLogger, currentRequest } from "./log";

const log = createLogger("auth");

export type UserRole = "user" | "admin";
export type UserStatus = "pending" | "approved" | "rejected";

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  /** Persona inside the synthetic company, or null if none was free (or a reseed removed it). */
  employeeId: string | null;
  createdAt: Date;
  approved: boolean;
  /** The shared guided demo account (src/lib/demo.ts): always demo mode, whatever its status. */
  isDemo: boolean;
};

/** Exported so code that acts as another account for one block (src/lib/demo.ts) can preset it. */
export const SESSION_MEMO_KEY = "sessionUser";
const MEMO_KEY = SESSION_MEMO_KEY;

/** Read the session cookie and load the account. Memoized per request. Null means signed out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = currentRequest();
  if (store?.memo?.has(MEMO_KEY)) return store.memo.get(MEMO_KEY) as SessionUser | null;
  const user = await loadSessionUser();
  if (store) (store.memo ??= new Map()).set(MEMO_KEY, user);
  return user;
}

async function loadSessionUser(): Promise<SessionUser | null> {
  let userId: string | undefined;
  try {
    const s = await auth();
    userId = s?.user?.id;
  } catch (err) {
    unstable_rethrow(err);
    log.warn("could not read the session cookie, treating request as signed out", { err });
    return null;
  }
  if (!userId) {
    log.debug("session: signed out (no valid session cookie)");
    return null;
  }
  const rows = await q("auth.session.user", (db) =>
    db
      .select({ id: t.users.id, email: t.users.email, role: t.users.role, status: t.users.status, employeeId: t.users.employeeId, createdAt: t.users.createdAt, isDemo: t.users.isDemo })
      .from(t.users)
      .where(eq(t.users.id, userId))
      .limit(1),
  );
  const row = rows[0];
  if (!row) {
    log.warn(`session: cookie names ${userId} but that account no longer exists, treating as signed out`, { userId });
    return null;
  }
  const user: SessionUser = { ...row, approved: row.status === "approved" };
  log.debug(`session: ${user.id} role=${user.role} status=${user.status} persona=${user.employeeId ?? "none"}${user.isDemo ? " (shared demo account)" : ""}`, { userId: user.id });
  return user;
}

/** For pages that need an account (/pending, /account). Redirects signed-out visitors to /login. */
export async function requireUser(path: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    log.info(`auth decision: redirect to /login for ${path} (signed out, page needs an account)`, { path });
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  log.debug(`auth decision: allow ${path} for ${user.id} (page needs an account, has one)`, { path, userId: user.id });
  return user;
}

/**
 * Gate for admin-only server work (reseed, approve, reject). The proxy already blocks /admin
 * pages for non-admins; this repeats the check for every action, since actions are POSTs that
 * could be replayed from anywhere.
 */
export async function requireAdmin(what: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    log.warn(`auth decision: deny ${what} (signed out, needs admin)`, { what });
    throw new AppError("AUTH_REQUIRED", undefined, { status: 401 });
  }
  if (user.role !== "admin") {
    log.warn(`auth decision: deny ${what} for ${user.id} (role ${user.role}, needs admin)`, { what, userId: user.id });
    throw new AppError("ADMIN_ONLY", undefined, { status: 403 });
  }
  log.debug(`auth decision: allow ${what} for ${user.id} (admin)`, { what, userId: user.id });
  return user;
}
