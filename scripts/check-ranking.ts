// pnpm rank:check
// Runs the offline half of prompt 6 against the seeded database for every planted person scenario
// and the composer examples: demo understanding, retrieval, features, ranking (pure, no model),
// the demo reasons with the same fact check the app runs, and the cooldown replayed by hand.
// It checks that the expected person is #1, that no trap is #1, which guardrails fired, and that
// a why-not line exists. Nothing is written to the database.
//
// Prompt 7: everything runs at the pinned demo clock, and each case is replayed at "blocked now"
// and "just curious" to check the channel rules: curious is always an async message; blocked now
// suggests a call or DM only for someone free within the hour, otherwise another owner who is,
// otherwise an async message; and focus time opens up only for blocked now.
//
// It reads the scenario table from fixtures/company.json; the app itself never does.

import "./lib/env";
import { eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { buildUnderstanding, loadCatalog } from "@/lib/understand-build";
import { embedText } from "@/lib/embed";
import { checkReason } from "@/lib/explain-check";
import { demoClock } from "@/lib/clock-server";
import { createLogger } from "@/lib/log";
import { demoReason, explainFacts, understandFixture } from "@/lib/model-purposes";
import { breakdownLine, COMPONENT_LABEL, COMPONENTS, rankCandidates, type Scored, templateReason } from "@/lib/rank";
import { buildFeatures } from "@/lib/rank-inputs";
import { retrieveCandidates } from "@/lib/retrieve";
import { readFixture } from "@/seed/fixture";
import { runScript } from "./lib/run";

const log = createLogger("rank.check");

const EXAMPLES = [
  "My deploy of invoice-worker to staging fails at the Helm upgrade step with \"context deadline exceeded\". The new pods never become ready and the release rolls back. Who can help me figure out why?",
  "A staging shipper got charged twice when a Stripe webhook retried. Where does billing-service check for duplicate events, and who knows that code?",
];

function person(s: Scored) {
  return {
    id: s.employeeId,
    firstName: s.name.split(" ")[0],
    evidence: [],
    components: COMPONENTS.map((c) => ({ key: c, label: COMPONENT_LABEL[c], points: s.contributions[c], detail: s.detail[c] })),
    load: s.load,
  };
}

await runScript("rank-check", async () => {
  const c = await readFixture();
  if (!c) throw new Error("fixtures/company.json not found");
  const catalog = await loadCatalog();
  const [planted] = await q("rank.check.planted", (db) => db.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, "seed.planted")));
  const asker = (JSON.parse(planted?.value ?? "[]") as Array<{ id: string; planted: string }>).find((p) => p.planted === "newhire_web")?.id ?? null;
  const now = (await demoClock("rank:check runs at the demo instant")).now;
  let problems = 0;
  const cases = [...c.scenarios.filter((s) => s.expectId !== "doc").map((s) => ({ id: s.id, text: s.question, sc: s })), ...EXAMPLES.map((text, i) => ({ id: `example_${i + 1}`, text, sc: null }))];
  const fired: Record<string, number> = {};
  const rules: Record<string, number> = {};
  let focusOpened = 0;
  for (const k of cases) {
    const f = understandFixture({ askId: k.id, text: k.text, catalog });
    const u = buildUnderstanding({ label: k.id, text: k.text, catalog, output: f.output, via: f.via, note: null, askUrgency: "blocked_today" });
    const { candidates } = await retrieveCandidates({ label: k.id, text: k.text, understanding: u, embedding: embedText(k.text), askerId: asker, now });
    const { features } = await buildFeatures({
      label: k.id,
      candidates,
      u,
      asker: { employeeId: asker, userId: null, visitorId: null },
      profile: { okToInterruptSeniors: false, knownSkillIds: [], preferredChannel: "slack", source: "check script" },
      urgency: u.urgency,
      now,
    });
    const out = rankCandidates(features, { tune: 0, cooled: {} });
    for (const r of out.guardrails) if (r.fired) fired[r.rule] = (fired[r.rule] ?? 0) + 1;
    const top = out.shortlist[0];
    const lines = out.shortlist.map((s) => `#${s.rank} ${s.employeeId} ${s.name} ${s.score}${s.flags.length ? ` [${s.flags.map((x) => x.rule).join(",")}]` : ""}`);
    for (const s of out.shortlist) log.debug(`${k.id} ${s.employeeId}: ${breakdownLine(s, out.weights)}`);
    const excluded = out.excluded.map((s) => `${s.employeeId} ${s.excluded!.rule}`);
    // demo reasons pass the fact check (evidence from retrieval)
    for (const s of out.shortlist) {
      const ev = candidates.find((x) => x.employeeId === s.employeeId)?.evidence.map((e) => e.detail) ?? [];
      const p = { ...person(s), evidence: ev };
      const reason = demoReason(p);
      const chk = checkReason(reason, explainFacts(p));
      if (!chk.ok) {
        problems++;
        log.warn(`${k.id} demo reason for ${s.employeeId} FAILS the fact check ${JSON.stringify(chk.dropped)}`);
      } else log.debug(`${k.id} reason ${s.employeeId}: ${reason} | template: ${templateReason(s)}`);
    }
    // the cooldown, replayed: the same top for the same asker again should move down
    if (top) {
      const again = rankCandidates(features, { tune: 0, cooled: { [top.employeeId]: { askId: "ask_prev", at: now.toISOString() } } });
      const cd = again.guardrails.find((r) => r.rule === "cooldown")!;
      log.info(`${k.id} cooldown replay: ${cd.fired ? "FIRED" : "not fired"}, new #1 ${again.shortlist[0]?.employeeId}: ${cd.summary}`);
    }
    for (const tune of [-1, 1]) {
      const o = rankCandidates(features, { tune, cooled: {} });
      log.info(`${k.id} tune ${tune}: ${o.shortlist.map((s) => `${s.employeeId} ${s.score}`).join(", ")}; fired ${o.guardrails.filter((r) => r.fired).map((r) => r.rule).join(",") || "none"}; ${o.guardrails.find((r) => r.rule === "spread")!.summary}`);
      for (const r of o.guardrails) if (r.fired) fired[`${r.rule}@${tune}`] = (fired[`${r.rule}@${tune}`] ?? 0) + 1;
    }
    // channel rules at the other two urgencies
    const base = { label: k.id, candidates, asker: { employeeId: asker, userId: null, visitorId: null }, profile: { okToInterruptSeniors: false, knownSkillIds: [], preferredChannel: "slack" as const, source: "check script" }, now };
    const [nowF, curiousF] = await Promise.all([buildFeatures({ ...base, u: { ...u, urgency: "blocked_now" }, urgency: "blocked_now" }), buildFeatures({ ...base, u: { ...u, urgency: "curious" }, urgency: "curious" })]);
    for (const [urg, fs] of [["blocked_now", nowF.features], ["curious", curiousF.features]] as const) {
      for (const f of fs) {
        const r = f.availability.recommendation;
        if (!r) {
          problems++;
          log.warn(`${k.id} ${urg} ${f.employeeId}: no recommendation`);
          continue;
        }
        rules[r.rule] = (rules[r.rule] ?? 0) + 1;
        const w = f.availability.window;
        const target = fs.find((x) => x.employeeId === r.targetId);
        const bad =
          urg === "curious"
            ? r.channel !== "async" || r.rule !== "curious_async"
            : r.rule === "blocked_now_free_within_hour"
              ? !w || w.minutesAway > 60 || r.channel === "async"
              : r.rule === "blocked_now_other_owner"
                ? (!!w && w.minutesAway <= 60) || r.targetId === f.employeeId || !!target?.excluded
                : r.rule !== "blocked_now_no_slot" || r.channel !== "async" || (!!w && w.minutesAway <= 60);
        if (bad) {
          problems++;
          log.warn(`${k.id} ${urg} ${f.employeeId}: rule ${r.rule} channel ${r.channel} does not match window ${w ? `${w.minutesAway} min away` : "none"}`);
        }
      }
    }
    for (const f of nowF.features) {
      const c = curiousF.features.find((x) => x.employeeId === f.employeeId);
      if (f.availability.window?.soft && c?.availability.window && c.availability.window.start > f.availability.window.start) focusOpened++;
    }
    const topNow = rankCandidates(nowF.features, { tune: 0, cooled: {} }).shortlist[0];
    if (topNow) log.info(`${k.id} blocked_now #1 ${topNow.employeeId}: ${topNow.availability.recommendation?.rule} "${topNow.availability.recommendation?.headline}"`);

    const ctx = { shortlist: lines, excluded, whyNot: out.whyNot?.text ?? null, guardrails: out.guardrails.filter((r) => r.fired).map((r) => r.rule) };
    if (!k.sc) {
      log.info(`${k.id}: top ${top?.employeeId} ${top?.name}`, ctx);
      continue;
    }
    const ok = top?.employeeId === k.sc.expectId;
    const trapTop = k.sc.trapIds.includes(top?.employeeId ?? "");
    if (!ok || trapTop) problems++;
    if (!out.whyNot) log.warn(`${k.id}: no why-not line`);
    log.info(`${k.id}: expected ${k.sc.expectId} ${ok ? "IS #1" : `NOT #1 (got ${top?.employeeId})`}; traps ${k.sc.trapIds.map((id) => `${id} ${out.excluded.some((s) => s.employeeId === id) ? "excluded" : (out.shortlist.find((s) => s.employeeId === id)?.rank ?? "out")}`).join(", ")}`, ctx);
  }
  log.info(`channel rules across cases (blocked_now and curious replays): ${JSON.stringify(rules)}; focus time opened for blocked_now but not curious: ${focusOpened} people`);
  if (!focusOpened) {
    problems++;
    log.warn("focus time never opened up for a blocked_now ask; the soft busy rule is not visible in the seed");
  }
  log.info(`${cases.length} cases, ${problems} problems; guardrails fired across cases: ${JSON.stringify(fired)}`);
  if (problems) process.exitCode = 1;
});
