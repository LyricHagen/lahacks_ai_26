import "server-only";
// Who is looking, for features that work signed out too (/ask, /dashboard). A signed-in account
// acts as its persona; a signed-out visitor acts as the default persona (planted newhire_web) and
// owns its asks through the httpOnly w2a_visitor cookie.

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { q } from "@/db";
import * as t from "@/db/schema";
import { getSessionUser, type SessionUser } from "./auth";
import { createLogger } from "./log";

const log = createLogger("viewer");

export const VISITOR_COOKIE = "w2a_visitor";
export const DEFAULT_PERSONA_KEY = "newhire_web";

export type Viewer = {
  user: SessionUser | null;
  /** Set for signed-out visitors who already have the cookie. */
  visitorId: string | null;
  /** The colleague this viewer acts as, or null if the company is not seeded. */
  personaId: string | null;
  isAdmin: boolean;
  /** For ask_events.actor_id and log lines. */
  actorId: string;
};

/** The planted default persona from app_meta seed.planted. */
export async function defaultPersonaId(): Promise<string | null> {
  const rows = await q("viewer.planted", (db) => db.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, "seed.planted")).limit(1));
  if (!rows[0]) {
    log.warn("no seed.planted in app_meta, so there is no default persona (database not seeded?)");
    return null;
  }
  try {
    const planted = JSON.parse(rows[0].value) as Array<{ id: string; planted: string }>;
    const hit = planted.find((p) => p.planted === DEFAULT_PERSONA_KEY);
    if (!hit) log.warn(`seed.planted has no ${DEFAULT_PERSONA_KEY}, so there is no default persona`);
    return hit?.id ?? null;
  } catch (err) {
    log.error("seed.planted in app_meta is not valid JSON", { err });
    return null;
  }
}

async function readVisitorCookie(): Promise<string | null> {
  try {
    const v = (await cookies()).get(VISITOR_COOKIE)?.value ?? null;
    return v && /^vis_[0-9a-f]{16}$/.test(v) ? v : null;
  } catch (err) {
    unstable_rethrow(err);
    log.debug("no cookie store (outside a request), no visitor id", { err });
    return null;
  }
}

export async function getViewer(): Promise<Viewer> {
  const user = await getSessionUser();
  if (user) {
    let personaId = user.employeeId;
    if (!personaId) {
      personaId = await defaultPersonaId();
      log.branch(`act as default persona ${personaId ?? "none"} for ${user.id}`, "account has no persona of its own");
    }
    return { user, visitorId: null, personaId, isAdmin: user.role === "admin", actorId: user.id };
  }
  const visitorId = await readVisitorCookie();
  const personaId = await defaultPersonaId();
  log.debug(`viewer: signed-out visitor ${visitorId ?? "(no cookie yet)"} acting as ${personaId ?? "none"}`);
  return { user: null, visitorId, personaId, isAdmin: false, actorId: visitorId ?? "visitor" };
}

/** For server actions: make sure a signed-out visitor has a visitor id, setting the cookie if needed. */
export async function ensureVisitorId(): Promise<string> {
  const existing = await readVisitorCookie();
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const id = `vis_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  (await cookies()).set(VISITOR_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 90 * 24 * 60 * 60 });
  log.info(`new visitor id ${id} (signed-out visitor made their first ask)`);
  return id;
}
