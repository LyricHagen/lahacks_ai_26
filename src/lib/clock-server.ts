import "server-only";
// The database half of the clock: the seed anchor day the demo pin is derived from. No session,
// no next/* imports, so scripts use demoClock() directly. Requests use getClock()
// (src/lib/clock-request.ts), which decides pinned or not from the mode.

import { eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { type AppClock, clockLabel, pinnedClock, systemClock } from "./clock";
import { createLogger } from "./log";

const log = createLogger("clock");

export async function loadAnchorDay(): Promise<string | null> {
  const [row] = await q("clock.anchor", (db) => db.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, "seed.anchor_day")).limit(1));
  return row?.value && /^\d{4}-\d{2}-\d{2}$/.test(row.value) ? row.value : null;
}

/** The pinned demo clock, or the system clock when the database was never seeded. Logs one line. */
export async function demoClock(why: string): Promise<AppClock> {
  const anchor = await loadAnchorDay();
  const c = anchor ? pinnedClock(anchor, `${why}, pinned to the seeded calendar window (seed anchor day ${anchor})`) : systemClock(`${why}, but seed.anchor_day is missing (database not seeded?), so the real time is used`);
  logClock(c);
  return c;
}

export function logClock(c: AppClock): void {
  const line = `clock=${c.pinned ? "pinned" : "system"} now=${c.now.toISOString()} (${clockLabel(c.now)}): ${c.reason}`;
  if (c.pinned || c.reason.includes("missing")) log.info(line, { anchorDay: c.anchorDay });
  else log.debug(line);
}
