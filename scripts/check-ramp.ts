// pnpm ramp:check
// Offline check of the ramp plan (prompt 9) and the insights threshold, against the seeded
// database, at the demo instant. No model call and no writes: the plan builder runs in dry run
// mode with a made-up ask history (demo understandings of composer examples) for the default
// persona. Checks:
//   - no history and too little history give the honest empty state, never a plan
//   - with enough history: 2 or 3 learn items, a stretch task and someone to meet, each pointing
//     at a row that exists, with sentences that pass the fact check and contain no dashes
//   - the person to meet is not the asker's manager and is under their weekly ask limit
//   - dismissing items leaves them out of the next plan and lowers their skill
//   - kAnon hides every cell under 5 asks and shows the rest

import "./lib/env";
import { eq, inArray } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { loadsThisWeek } from "@/lib/availability";
import { demoClock } from "@/lib/clock-server";
import { checkReason } from "@/lib/explain-check";
import { K_MIN_ASKS, kAnon } from "@/lib/k-anon";
import { createLogger } from "@/lib/log";
import { RAMP_CONNECTIVES, understandFixture } from "@/lib/model-purposes";
import { buildRampPlan } from "@/lib/ramp-build";
import type { RampOwner } from "@/lib/ramp-signals";
import { RAMP_LEARN_MAX, RAMP_LEARN_MIN, type RampItem, type RampPlanReady } from "@/lib/ramp-types";
import { buildUnderstanding, loadCatalog } from "@/lib/understand-build";
import { runScript } from "./lib/run";

const log = createLogger("ramp.check");

const EXAMPLES = [
  "A staging shipper got charged twice when a Stripe webhook retried. Where does billing-service check for duplicate events, and who knows that code?",
  "Consumer lag on the shipment events topic keeps growing in ingest-pipeline since this morning. Is this expected after the Airflow backfill, or should someone look at it?",
  "How do people usually add a feature flag in flagd for a change in the web app? I want to understand the convention before my first rollout.",
  "My deploy of invoice-worker to staging fails at the Helm upgrade step with \"context deadline exceeded\". The new pods never become ready and the release rolls back. Who can help me figure out why?",
];

await runScript("ramp-check", async () => {
  const catalog = await loadCatalog();
  const { now } = await demoClock("ramp:check runs at the demo instant");
  const [planted] = await q("ramp.check.planted", (db) => db.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, "seed.planted")));
  const personaId = (JSON.parse(planted?.value ?? "[]") as Array<{ id: string; planted: string }>).find((p) => p.planted === "newhire_web")?.id;
  if (!personaId) throw new Error("no newhire_web persona: run pnpm seed first");
  const [persona] = await q("ramp.check.persona", (db) => db.select({ managerId: t.employees.managerId }).from(t.employees).where(eq(t.employees.id, personaId)));

  const asks = EXAMPLES.map((text, i) => {
    const f = understandFixture({ askId: `chk_${i + 1}`, text, catalog });
    return { id: `chk_${i + 1}`, status: "shortlist", understanding: buildUnderstanding({ label: `chk_${i + 1}`, text, catalog, output: f.output, via: f.via, note: null, askUrgency: "blocked_today" }) };
  });
  const owner = (n: number, dismissed: Array<{ refId: string; skillId: string | null }> = []): RampOwner => ({
    owner: "chk_owner",
    userId: null,
    visitorId: "vis_check",
    personaId,
    knownSkillIds: null,
    offline: { asks: asks.slice(0, n), dismissed },
  });
  let problems = 0;
  const fail = (what: string, ctx?: Record<string, unknown>) => {
    problems++;
    log.error(`PROBLEM ${what}`, ctx);
  };

  // 1. honest empty states
  for (const n of [0, 2]) {
    const r = await buildRampPlan({ owner: owner(n), week: "this", now, mode: "demo", user: null, dryRun: true });
    if (r.plan.status !== "not_enough_history") fail(`${n} asks gave a plan instead of the empty state`);
    else log.info(`ok: ${n} asks -> not enough history: "${r.plan.reason}"`);
  }

  // 2. a real plan
  const first = await buildRampPlan({ owner: owner(asks.length), week: "this", now, mode: "demo", user: null, dryRun: true });
  if (first.plan.status !== "ready") throw new Error(`with ${asks.length} asks the plan is ${first.plan.status}`);
  const plan = first.plan;
  const items = [...plan.learn, plan.stretch, plan.meet].filter((x): x is RampItem => !!x);
  if (plan.learn.length < RAMP_LEARN_MIN || plan.learn.length > RAMP_LEARN_MAX) fail(`learn has ${plan.learn.length} items`);
  if (!plan.stretch) fail("no stretch task", { why: plan.missing.stretch });
  if (!plan.meet) fail("nobody to meet", { why: plan.missing.meet });
  const ids = (kind: RampItem["refKind"]) => items.filter((i) => i.refKind === kind).map((i) => i.refId);
  const [docs, emps, prjs] = await Promise.all([
    ids("document").length ? q("ramp.check.docs", (db) => db.select({ id: t.documents.id }).from(t.documents).where(inArray(t.documents.id, ids("document")))) : [],
    ids("employee").length ? q("ramp.check.emps", (db) => db.select({ id: t.employees.id, max: t.employees.maxWeeklyAsks }).from(t.employees).where(inArray(t.employees.id, ids("employee")))) : [],
    ids("project").length ? q("ramp.check.prjs", (db) => db.select({ id: t.projects.id, status: t.projects.status }).from(t.projects).where(inArray(t.projects.id, ids("project")))) : [],
  ]);
  const exists = new Set([...docs, ...emps, ...prjs].map((r) => r.id));
  const loads = await loadsThisWeek(emps.map((e) => e.id), now);
  for (const i of items) {
    if (!exists.has(i.refId)) fail(`${i.section} ${i.refId} does not exist in the database`);
    if (!i.href.endsWith(i.refId)) fail(`${i.section} ${i.refId} links to ${i.href}`);
    for (const text of [i.why, i.task ?? ""]) {
      if (/[\u2014\u2013]/.test(text)) fail(`${i.refId} has a dash`, { text });
      const c = checkReason(text, [...i.facts, ...plan.gaps.flatMap((g) => [g.name, ...g.signals]), ...RAMP_CONNECTIVES, "Web"]);
      if (c.dropped.length) fail(`${i.refId} sentence fails the fact check`, { dropped: c.dropped });
    }
    if (i.textSource === "template") fail(`${i.refId} fell back to template text in demo mode`);
    log.info(`ok: ${i.section} ${i.refId} ${i.title}: "${i.why}"${i.task ? ` task "${i.task}"` : ""}`);
  }
  if (plan.meet) {
    const m = emps.find((e) => e.id === plan.meet!.refId);
    if (plan.meet.refId === persona?.managerId) fail("the person to meet is the asker's manager");
    if (m && (loads.get(m.id) ?? 0) >= m.max) fail(`the person to meet ${m.id} is at their weekly limit`);
    if (plan.learn.some((l) => l.refId === plan.meet!.refId)) fail("the person to meet is also on the learn list");
  }
  if (prjs.some((p) => p.status !== "active")) fail("stretch task is on a finished project");
  log.info(`plan gaps: ${plan.gaps.map((g) => `${g.name} ${g.score}`).join(", ")}`);

  // 3. dismissals change the next plan
  const dropped = [plan.learn[0], plan.meet].filter((x): x is RampItem => !!x);
  const next = await buildRampPlan({ owner: owner(asks.length, dropped.map((d) => ({ refId: d.refId, skillId: d.skillId }))), week: "next", now, mode: "demo", user: null, dryRun: true });
  const np = next.plan as RampPlanReady;
  if (np.status !== "ready") fail("plan after dismissals is not ready");
  else {
    const nextRefs = [...np.learn, np.stretch, np.meet].filter(Boolean).map((i) => i!.refId);
    for (const d of dropped) if (nextRefs.includes(d.refId)) fail(`dismissed ${d.refId} is still in next week's plan`);
    if (np.leftOut.length !== dropped.length) fail(`leftOut lists ${np.leftOut.length}, expected ${dropped.length}`);
    const before = plan.gaps.find((g) => g.skillId === plan.learn[0].skillId);
    const after = np.gaps.find((g) => g.skillId === plan.learn[0].skillId);
    if (before && after && after.score >= before.score) fail(`dismissing did not lower ${before.name}`, { before: before.score, after: after.score });
    log.info(`ok: after dismissing ${dropped.map((d) => d.refId).join(", ")} next week is ${nextRefs.join(", ")}; ${before?.name} ${before?.score} -> ${after?.score ?? "dropped out of the top gaps"}`);
    if (np.weekStart <= plan.weekStart) fail(`next week ${np.weekStart} is not after ${plan.weekStart}`);
  }

  // 4. k-anonymity
  for (const n of [0, 1, K_MIN_ASKS - 1, K_MIN_ASKS, 40]) {
    const cell = kAnon("check", `n=${n}`, n, n);
    if (cell.shown !== n >= K_MIN_ASKS) fail(`kAnon(${n}) shown=${cell.shown}`);
    if (!cell.shown && cell.count !== null) fail(`kAnon(${n}) leaked its count`);
  }
  log.info(`ok: kAnon hides counts under ${K_MIN_ASKS}`);

  if (problems) {
    log.error(`ramp:check found ${problems} problems`);
    process.exitCode = 1;
  } else log.info("ramp:check: 0 problems");
});
