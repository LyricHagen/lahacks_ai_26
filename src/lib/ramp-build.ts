import "server-only";
// Builds (or reuses) one owner's ramp plan for one week. No session or next/* imports: the request
// wrapper (src/lib/ramp.ts) passes the owner, the app time and the mode; pnpm ramp:check passes
// its own. Log lines (grep "ramp"):
//
//   [ramp] INFO ramp plan usr_2 week 2026-10-19: reused (signature 3f2a91c0 unchanged)
//   [ramp] INFO ramp plan usr_2 week 2026-10-26: built via=demo, 3 learn, stretch prj_10, meet emp_131 (signature ...)
//   [ramp] INFO ramp plan usr_9 week 2026-10-19: NOT ENOUGH HISTORY (1 of 3 confirmed asks)

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { wallNow } from "./clock";
import { checkReason, cleanModelText } from "./explain-check";
import { createLogger } from "./log";
import { callModel, type ScriptActor } from "./model";
import type { SessionUser } from "./auth";
import type { Mode, ResolvedMode } from "./mode";
import { demoRampPlan, RAMP_CONNECTIVES, type RampInput, type RampOutput, type RampPoolItem } from "./model-purposes";
import { gatherRampSignals, type RampCandidate, type RampOwner, type RampSignals } from "./ramp-signals";
import { RAMP_MIN_ASKS, type RampItem, type RampPlan, type RampPlanReady, type RampSection, type RampWeek } from "./ramp-types";
import { addDays, localDate, weekday } from "./time";

const log = createLogger("ramp");

/** Bump to rebuild every stored plan after a change to how plans are made. */
export const RAMP_VERSION = "ramp-v1";

/** Monday of the week that contains `now` in the zone, as YYYY-MM-DD. */
export function mondayOf(now: Date, tz: string): string {
  const d = localDate(now, tz);
  const wd = weekday(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

export function weekStartFor(week: RampWeek, now: Date, tz: string): string {
  const monday = mondayOf(now, tz);
  return week === "next" ? addDays(monday, 7) : monday;
}

const HREF: Record<RampCandidate["kind"], (id: string) => string> = {
  document: (id) => `/docs/${id}`,
  employee: (id) => `/directory/${id}`,
  project: (id) => `/projects/${id}`,
};

export type RampBuildArgs = {
  owner: RampOwner;
  week: RampWeek;
  now: Date;
  mode: ResolvedMode | Mode;
  user: SessionUser | ScriptActor | null;
  /** Skip the stored plan, the write and the gate (offline checks): the demo result is used. */
  dryRun?: boolean;
};

export type RampBuildResult = { plan: RampPlan; weekStart: string; reused: boolean; signals: RampSignals | null };

export async function buildRampPlan(a: RampBuildArgs): Promise<RampBuildResult> {
  const signals = await gatherRampSignals(a.owner, a.now);
  const persona = signals?.persona;
  const tz = persona?.timezone ?? "America/Los_Angeles";
  const weekStart = weekStartFor(a.week, a.now, tz);
  const label = `ramp plan ${a.owner.owner} week ${weekStart}`;
  const base = {
    version: 1 as const,
    weekStart,
    persona: { id: persona?.id ?? a.owner.personaId, name: persona?.name ?? "", team: persona?.team ?? "", daysIn: persona?.daysIn ?? null },
    history: signals?.history ?? { asks: 0, askIds: [], services: [], skills: [] },
    builtAt: wallNow().toISOString(),
    appNow: a.now.toISOString(),
  };

  if (!signals || signals.history.asks < RAMP_MIN_ASKS) {
    const have = signals?.history.asks ?? 0;
    log.info(`${label}: NOT ENOUGH HISTORY (${have} of ${RAMP_MIN_ASKS} confirmed asks)`, { owner: a.owner.owner });
    log.branch("honest empty state, no model call", `a plan needs ${RAMP_MIN_ASKS} asks that got past the confirm step; this owner has ${have}`);
    const reason =
      have === 0
        ? "You have not made an ask that got past the confirm step yet. The plan is built only from your own asks, so there is nothing to build it from."
        : `You have ${have} ${have === 1 ? "ask" : "asks"} past the confirm step. The plan needs ${RAMP_MIN_ASKS} before it can point at a real gap instead of guessing.`;
    return { plan: { ...base, status: "not_enough_history", reason, need: RAMP_MIN_ASKS }, weekStart, reused: false, signals };
  }
  if (!signals.gaps.length) {
    log.info(`${label}: NOT ENOUGH HISTORY (asks name no service or skill)`, { owner: a.owner.owner });
    return {
      plan: { ...base, status: "not_enough_history", reason: "Your asks do not name a service or skill yet, so there is no gap to plan around. Asks that mention the system you are working on help.", need: RAMP_MIN_ASKS },
      weekStart,
      reused: false,
      signals,
    };
  }

  // This week's plan stays put when only dismissals change (they show as dismissed); next week's
  // preview includes them, so a dismissal changes it at once.
  const dismissKey = a.week === "next" ? signals.dismissed.map((d) => d.refId).sort().join(",") : "";
  const signature = createHash("sha256").update(`${RAMP_VERSION}|${a.week}|${signals.basis}|${dismissKey}`).digest("hex").slice(0, 16);

  if (!a.dryRun) {
    const [row] = await q("ramp.plan.get", (db) =>
      db.select({ signature: t.rampPlans.signature, plan: t.rampPlans.plan }).from(t.rampPlans).where(and(eq(t.rampPlans.owner, a.owner.owner), eq(t.rampPlans.weekStart, weekStart))).limit(1),
    );
    if (row && row.signature === signature) {
      log.info(`${label}: reused (signature ${signature} unchanged)`);
      return { plan: row.plan as RampPlan, weekStart, reused: true, signals };
    }
    log.branch(`${label}: build`, row ? `signature changed (${row.signature} to ${signature}): new asks, profile or dismissals` : "no plan stored for this week yet");
  }

  const pool = (cs: RampCandidate[]): RampPoolItem[] => cs.map((c) => ({ ref: c.ref, kind: c.kind, title: c.title, skill: c.skillId ? (signals.gaps.find((g) => g.skillId === c.skillId)?.name ?? null) : null, facts: c.facts, meta: c.meta }));
  const input: RampInput = {
    owner: a.owner.owner,
    weekStart,
    asker: { firstName: signals.persona.firstName, team: signals.persona.team, daysIn: signals.persona.daysIn },
    gaps: signals.gaps.map((g) => ({ skillId: g.skillId, name: g.name, signals: g.signals })),
    learn: pool(signals.pools.learn),
    stretch: pool(signals.pools.stretch),
    meet: pool(signals.pools.meet),
  };
  log.info(`${label}: ramp input payload ${JSON.stringify({ ...input, learn: input.learn.map((x) => x.ref), stretch: input.stretch.map((x) => x.ref), meet: input.meet.map((x) => x.ref) })}`);

  // Offline checks never touch the gate (no usage row): they get the demo result directly.
  if (a.dryRun) log.branch("ramp_plan demo result without callModel", "dry run (pnpm ramp:check)");
  const r = a.dryRun ? { source: "fixture" as const, output: demoRampPlan(input), outcome: "mode_demo" as const, note: "Cached demo result: offline check." } : await callModel({ purpose: "ramp_plan", input, user: a.user, mode: a.mode });
  const source: RampPlanReady["source"] = r.source === "live" ? "live" : r.source === "fixture" ? "demo" : "template";
  const out: RampOutput = r.output ?? demoRampPlan(input);
  const demo = demoRampPlan(input);
  if (r.source === "none") log.branch("template plan", `no model result and no fixture (${r.code}); the demo lines are used`);

  const pools: Record<RampSection, RampCandidate[]> = signals.pools;
  const find = (section: RampSection, ref: string) => pools[section].find((c) => c.ref === ref)!;
  const allowed = (c: RampCandidate) => [...c.facts, ...signals.gaps.flatMap((g) => [g.name, ...g.signals]), signals.persona.firstName, signals.persona.team, ...RAMP_CONNECTIVES];
  // Each sentence is checked against the item's own facts; a sentence with a fact not in them falls back to the demo line.
  const checked = (section: RampSection, ref: string, text: string, fallback: string | undefined, what: string): { text: string; src: RampItem["textSource"] } => {
    const c = find(section, ref);
    const clean = cleanModelText(text);
    const res = checkReason(clean, allowed(c));
    for (const d of res.dropped) log.warn(`${label}: ${section} ${ref} ${what} DROPPED sentence with facts not in the evidence ${JSON.stringify(d.unsupported)}: "${d.sentence}"`);
    if (res.dropped.length === 0) {
      log.info(`${label}: ${section} ${ref} ${what} via=${source}: "${clean}"`);
      return { text: clean, src: source };
    }
    const fb = fallback ?? clean;
    log.info(`${label}: ${section} ${ref} ${what} via=template (fact check failed): "${fb}"`);
    return { text: fb, src: "template" };
  };
  const item = (section: RampSection, ref: string, why: string, task: string | null, fb: { why?: string; task?: string | null }): RampItem => {
    const c = find(section, ref);
    const w = checked(section, ref, why, fb.why, "why");
    const tk = task ? checked(section, ref, task, fb.task ?? undefined, "task") : null;
    return {
      section,
      refKind: c.kind,
      refId: c.ref,
      href: HREF[c.kind](c.ref),
      title: c.title,
      subtitle: c.subtitle,
      why: w.text,
      task: tk?.text ?? null,
      skillId: c.skillId,
      skillName: c.skillId ? (signals.gaps.find((g) => g.skillId === c.skillId)?.name ?? null) : null,
      facts: c.facts,
      textSource: w.src === "template" || tk?.src === "template" ? "template" : w.src,
    };
  };
  // The demo line for one exact ref, used when a live sentence fails the fact check.
  const only = (ref: string) => demoRampPlan({ ...input, learn: input.learn.filter((x) => x.ref === ref), stretch: input.stretch.filter((x) => x.ref === ref), meet: input.meet.filter((x) => x.ref === ref) });
  const learn = out.learn.map((x) => item("learn", x.ref, x.why, null, { why: demo.learn.find((d) => d.ref === x.ref)?.why ?? only(x.ref).learn[0]?.why }));
  const stretch = out.stretch ? item("stretch", out.stretch.ref, out.stretch.why, out.stretch.task, { why: only(out.stretch.ref).stretch?.why, task: only(out.stretch.ref).stretch?.task }) : null;
  const meet = out.meet ? item("meet", out.meet.ref, out.meet.why, null, { why: only(out.meet.ref).meet?.why }) : null;

  const plan: RampPlanReady = {
    ...base,
    status: "ready",
    gaps: signals.gaps,
    learn,
    stretch,
    meet,
    missing: signals.missing,
    leftOut: signals.dismissed.map((d) => d.refId),
    source,
    note: r.source === "live" ? null : r.note,
  };
  log.info(`${label}: built via=${source}, ${learn.length} learn (${learn.map((l) => l.refId).join(", ")}), stretch ${stretch?.refId ?? "none"}, meet ${meet?.refId ?? "none"}; left out ${plan.leftOut.length} dismissed (signature ${signature})`);

  if (!a.dryRun) {
    // The plan names the owner's own asks by id only, never their text.
    await q("ramp.plan.upsert", (db) =>
      db
        .insert(t.rampPlans)
        .values({ owner: a.owner.owner, userId: a.owner.userId, visitorId: a.owner.visitorId, employeeId: signals.persona.id, weekStart, signature, status: plan.status, source, plan })
        .onConflictDoUpdate({ target: [t.rampPlans.owner, t.rampPlans.weekStart], set: { signature, status: plan.status, source, plan, employeeId: signals.persona.id, createdAt: wallNow() } }),
    );
  }
  return { plan, weekStart, reused: false, signals };
}
