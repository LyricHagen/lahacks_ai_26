import "server-only";
// The ramp plan for the current request: who is looking, at what app time, in which mode.
// Dismissals live here too. The plan itself is built in src/lib/ramp-build.ts.

import { and, eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { getClock } from "./clock-request";
import { AppError } from "./errors";
import { createLogger } from "./log";
import { currentMode } from "./mode-request";
import { getProfile } from "./onboarding";
import { buildRampPlan, weekStartFor } from "./ramp-build";
import { gatherRampSignals, type RampOwner } from "./ramp-signals";
import { RAMP_MIN_ASKS, RAMP_SECTIONS, type RampPlan, type RampSection, type RampWeek } from "./ramp-types";
import { ensureVisitorId, getViewer, type Viewer } from "./viewer";

const log = createLogger("ramp");

async function ownerFor(viewer: Viewer): Promise<RampOwner | null> {
  if (!viewer.personaId) return null;
  const owner = viewer.user?.id ?? viewer.visitorId;
  const profile = viewer.user ? await getProfile(viewer.user.id) : null;
  return {
    owner: owner ?? "visitor",
    userId: viewer.user?.id ?? null,
    visitorId: viewer.user ? null : viewer.visitorId,
    personaId: viewer.personaId,
    // Only what they really told us; skipped or missing context falls back to the persona's skills.
    knownSkillIds: profile?.contextAt && !profile.usedDefaults ? profile.knownSkillIds : null,
  };
}

export type RampView = { plan: RampPlan | null; dismissed: Set<string>; weekStart: string | null; reused: boolean; clockPinned: boolean };

export async function getRampView(week: RampWeek): Promise<RampView> {
  const [viewer, clock, mode] = await Promise.all([getViewer(), getClock(), currentMode()]);
  const owner = await ownerFor(viewer);
  if (!owner) {
    log.warn("ramp: no persona to plan for (company not seeded?)");
    return { plan: null, dismissed: new Set(), weekStart: null, reused: false, clockPinned: clock.pinned };
  }
  const r = await buildRampPlan({ owner, week, now: clock.now, mode, user: viewer.user });
  const dismissed = await q("ramp.dismissed.list", (db) => db.select({ refId: t.rampDismissals.refId }).from(t.rampDismissals).where(eq(t.rampDismissals.owner, owner.owner)));
  return { plan: r.plan, dismissed: new Set(dismissed.map((d) => d.refId)), weekStart: r.weekStart, reused: r.reused, clockPinned: clock.pinned };
}

/** For the dashboard line: no model call, only the stored plan or the history count. */
export async function rampSummary(viewer: Viewer): Promise<{ daysIn: number | null; plan: { learn: number; stretch: boolean; meet: boolean } | null; asks: number; need: number } | null> {
  const owner = await ownerFor(viewer);
  if (!owner) return null;
  const clock = await getClock();
  const s = await gatherRampSignals(owner, clock.now);
  if (!s) return null;
  const weekStart = weekStartFor("this", clock.now, s.persona.timezone);
  const [row] = await q("ramp.summary.plan", (db) => db.select({ plan: t.rampPlans.plan }).from(t.rampPlans).where(and(eq(t.rampPlans.owner, owner.owner), eq(t.rampPlans.weekStart, weekStart))).limit(1));
  const p = row?.plan as RampPlan | undefined;
  const plan = p?.status === "ready" ? { learn: p.learn.length, stretch: !!p.stretch, meet: !!p.meet } : null;
  log.debug(`ramp summary for ${owner.owner}: ${s.history.asks} confirmed asks, ${plan ? "plan stored for this week" : "no plan stored yet"}`);
  return { daysIn: s.persona.daysIn, plan, asks: s.history.asks, need: RAMP_MIN_ASKS };
}

// ---------------------------------------------------------------------------
// dismissals
// ---------------------------------------------------------------------------

export async function dismissRampItem(input: { weekStart?: unknown; refId?: unknown }): Promise<{ refId: string }> {
  const viewer = await getViewer();
  const owner = viewer.user?.id ?? (viewer.personaId ? await ensureVisitorId() : null);
  const weekStart = String(input?.weekStart ?? "");
  const refId = String(input?.refId ?? "");
  if (!owner || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new AppError("BAD_REQUEST", "That plan does not exist.", { status: 400 });
  const [row] = await q("ramp.dismiss.plan", (db) => db.select({ plan: t.rampPlans.plan }).from(t.rampPlans).where(and(eq(t.rampPlans.owner, owner), eq(t.rampPlans.weekStart, weekStart))).limit(1));
  const plan = row?.plan as RampPlan | undefined;
  const item = plan?.status === "ready" ? [...plan.learn, plan.stretch, plan.meet].find((i) => i?.refId === refId) : undefined;
  if (!item) {
    log.warn(`ramp dismiss refused for ${owner}: ${refId} is not in their plan for week ${weekStart}`);
    throw new AppError("RAMP_ITEM_NOT_FOUND", undefined, { status: 404 });
  }
  if (!(RAMP_SECTIONS as readonly RampSection[]).includes(item.section)) throw new AppError("BAD_REQUEST", undefined, { status: 400 });
  await q("ramp.dismiss.insert", (db) =>
    db
      .insert(t.rampDismissals)
      .values({ owner, userId: viewer.user?.id ?? null, visitorId: viewer.user ? null : owner, section: item.section, refId, skillId: item.skillId, weekStart })
      .onConflictDoNothing(),
  );
  log.info(`ramp dismissed ${refId} (${item.section}${item.skillName ? `, for ${item.skillName}` : ""}) by ${owner} from week ${weekStart}; later plans leave it out${item.skillName ? ` and lower ${item.skillName}` : ""}`);
  return { refId };
}

export async function undoRampDismissal(input: { refId?: unknown }): Promise<{ refId: string }> {
  const viewer = await getViewer();
  const owner = viewer.user?.id ?? viewer.visitorId;
  const refId = String(input?.refId ?? "");
  if (!owner) throw new AppError("RAMP_ITEM_NOT_FOUND", undefined, { status: 404 });
  const res = await q("ramp.dismiss.undo", (db) => db.delete(t.rampDismissals).where(and(eq(t.rampDismissals.owner, owner), eq(t.rampDismissals.refId, refId))).returning({ id: t.rampDismissals.id }));
  if (!res.length) {
    log.warn(`ramp undo refused for ${owner}: ${refId} was not dismissed`);
    throw new AppError("RAMP_ITEM_NOT_FOUND", undefined, { status: 404 });
  }
  log.info(`ramp dismissal undone: ${refId} by ${owner}; it can come back in later plans`);
  return { refId };
}
