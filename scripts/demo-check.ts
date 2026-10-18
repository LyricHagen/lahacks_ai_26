// pnpm demo:check
// Resets the guided demo exactly like the Reset demo button (in demo mode: no model call), then
// checks the story the guided steps tell: the deploy ask names billing-service, a billing runbook
// is offered and marked as not answering it, the primary owner is left off for being at their
// weekly limit, the backup owner is #1 and still has room so "I sent this" moves their load, and
// the history is in place. It also counts which demo results came from recorded live answers
// (fixtures/model/) and which fell back to the deterministic path, by purpose. Writes to the
// database (it IS a reset); safe to run any time.

import "./lib/env";
import { and, eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { loadThisWeek } from "@/lib/availability";
import { asRanking } from "@/lib/ask-review";
import { demoClock } from "@/lib/clock-server";
import { readDemoState, resetDemo } from "@/lib/demo";
import { GUIDED_SERVICE } from "@/lib/demo-script";
import { createLogger } from "@/lib/log";
import { runAsScript } from "@/lib/model";
import { recordedCounts } from "@/lib/model-fixtures";
import { normalizeUnderstanding } from "@/lib/understanding";
import { runScript } from "./lib/run";

const log = createLogger("demo.check");

await runScript("demo-check", async () => {
  const problems: string[] = [];
  const served: Record<string, { recorded: number; deterministic: number; misses: string[] }> = {};
  const report = await runAsScript(
    {
      actor: { kind: "script", name: "demo:check" },
      onFixture: (f) => {
        const s = (served[f.purpose] ??= { recorded: 0, deterministic: 0, misses: [] });
        s[f.kind]++;
        if (f.kind === "deterministic" && f.hash) s.misses.push(f.hash);
      },
    },
    () => resetDemo("pnpm demo:check"),
  );
  log.info(`reset took ${report.ms}ms; deleted ${report.deleted.asks} asks; ${report.loads.length} load counters changed`);
  if (report.ms > 8000) problems.push(`reset took ${report.ms}ms, slower than 8s`);

  const state = await readDemoState();
  if (!state) throw new Error("no demo state after the reset");
  const askId = state.guidedAskId;
  const [ask] = await q("demo.check.ask", (db) => db.select().from(t.asks).where(eq(t.asks.id, askId)).limit(1));
  if (ask.status !== "ready") problems.push(`guided ask ${askId} is ${ask.status}, expected ready`);
  const u = normalizeUnderstanding(ask.understanding);
  if (!u?.services.some((s) => s.id === GUIDED_SERVICE)) problems.push(`guided understanding does not name ${GUIDED_SERVICE}`);
  if (u?.edits.length) log.warn(`guided ask needed corrections on the confirm screen: ${u.edits.join("; ")}`);
  log.info(`guided understanding via=${u?.via}: services ${u?.services.map((s) => s.id).join(", ")}; skills ${u?.skills.map((s) => s.id).join(", ")}; artifacts ${u?.artifacts.map((a) => a.text).join(" | ")}`);

  const docs = await q("demo.check.docs", (db) => db.select({ id: t.askDocChecks.documentId, verdict: t.askDocChecks.verdict, score: t.askDocChecks.score, service: t.documents.serviceId }).from(t.askDocChecks).innerJoin(t.documents, eq(t.documents.id, t.askDocChecks.documentId)).where(eq(t.askDocChecks.askId, askId)));
  log.info(`guided docs offered: ${docs.map((d) => `${d.id} (${d.service}) score ${d.score} verdict ${d.verdict}`).join("; ") || "none"}`);
  if (!docs.some((d) => d.service === GUIDED_SERVICE && d.verdict === "not_answered")) problems.push("no billing document was offered and marked not_answered (the documents step has nothing to show)");

  const [svc] = await q("demo.check.svc", (db) => db.select({ primary: t.services.primaryOwnerId, secondary: t.services.secondaryOwnerId }).from(t.services).where(eq(t.services.id, GUIDED_SERVICE)));
  const ranking = asRanking(ask.ranking);
  const hard = ranking?.guardrails.find((g) => g.rule === "hard_cap");
  log.info(`guided shortlist ${ranking?.shortlistIds.join(", ")}; hard cap ${hard?.fired ? "FIRED" : "not fired"}: ${hard?.summary}; why not ${ranking?.whyNot?.employeeId}: ${ranking?.whyNot?.text}`);
  if (ranking?.shortlistIds[0] !== svc.secondary) problems.push(`guided #1 is ${ranking?.shortlistIds[0]}, expected the backup owner ${svc.secondary}`);
  if (!hard?.fired) problems.push("hard cap did not fire on the guided ask");
  if (ranking?.whyNot?.employeeId !== svc.primary) problems.push(`why-not names ${ranking?.whyNot?.employeeId}, expected the primary owner ${svc.primary}`);
  const [chosen] = await q("demo.check.chosen", (db) => db.select({ id: t.askCandidates.employeeId }).from(t.askCandidates).where(and(eq(t.askCandidates.askId, askId), eq(t.askCandidates.chosen, true))));
  const clock = await demoClock("demo:check");
  const [emp] = await q("demo.check.emp", (db) => db.select({ max: t.employees.maxWeeklyAsks, name: t.employees.name }).from(t.employees).where(eq(t.employees.id, chosen.id)));
  const load = await loadThisWeek(chosen.id, clock.now);
  log.info(`guided recipient ${chosen.id} ${emp.name}: ${load} of ${emp.max} asks this week before the send`);
  if (load >= emp.max) problems.push(`the recipient is already at ${load} of ${emp.max}, so the send step cannot show the load moving`);
  const msgs = await q("demo.check.msgs", (db) => db.select({ variant: t.askMessages.variant }).from(t.askMessages).where(eq(t.askMessages.askId, askId)));
  if (msgs.length !== 3) problems.push(`guided ask has ${msgs.length} draft variants, expected 3`);

  for (const h of state.history) log.info(`history ${h.key} ${h.askId}: ${h.state}${h.recipientId ? ` to ${h.recipientId}` : ""}`);
  const want: Record<string, string> = { staging_db: "answered", invoice_pdf: "answered", payout_lag: "sent" };
  for (const h of state.history) if (want[h.key] && want[h.key] !== h.state) problems.push(`history ${h.key} is ${h.state}, expected ${want[h.key]}`);
  if (state.history.some((h) => h.recipientId === chosen.id)) problems.push("a history ask went to the guided recipient (their load would already be up)");

  const [plan] = await q("demo.check.ramp", (db) => db.select({ status: t.rampPlans.status, source: t.rampPlans.source }).from(t.rampPlans).where(eq(t.rampPlans.owner, state.accountId)));
  log.info(`ramp plan for the demo account: ${plan?.status ?? "none"} via ${plan?.source ?? "-"}`);
  if (plan?.status !== "ready") problems.push(`demo account ramp plan is ${plan?.status ?? "missing"}, expected ready`);

  log.info(`recorded fixtures in fixtures/model: ${JSON.stringify(recordedCounts())}`);
  for (const [p, s] of Object.entries(served)) log.info(`demo results ${p}: ${s.recorded} recorded, ${s.deterministic} deterministic${s.misses.length ? ` (misses ${s.misses.join(", ")})` : ""}`);
  if (problems.length) {
    for (const p of problems) log.error(`PROBLEM ${p}`);
    process.exitCode = 1;
  } else log.info(`demo:check ok: guided ${askId} tells the whole story; reset in ${report.ms}ms`);
});
