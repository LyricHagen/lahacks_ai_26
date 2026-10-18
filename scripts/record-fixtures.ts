// pnpm fixtures:record [--dry-run] [--only-missing]
//
// Records real live answers for every model call the demo makes, once, with the owner's key, into
// fixtures/model/<purpose>.json. Commit the output: demo mode then replays it and never calls a
// model. Inputs that were not recorded fall back to the deterministic demo path (logged as
// "fixture MISS ... hash=..."), so recording more later is optional.
//
// What it runs, at the pinned demo clock (the clock demo mode uses, so the hashes match):
//   phase 1, right after a reset: the guided demo (history, guided ask, ramp plan), then every
//            composer example as the demo account and as a fresh signed-out visitor
//   phase 2, after "I sent this" on the guided ask (where a presenter is when judges type their
//            own asks): the demo account's ramp plan again, and every example again for both
// Each example goes through confirm, the shortlist (#1 chosen) and the draft, then is deleted, so
// the next starts from the same state. Then it writes the files, resets the demo in demo mode and
// replays phase 1 to report how many demo results now come from recordings.
//
// A reseed on another day changes the calendars (they are generated from the load day), so
// availability and draft inputs change and their recordings stop matching. Record after the last
// reseed before a demo; pnpm demo:check shows the hit rate any time.
//
//   --dry-run       no key needed, nothing written: every step in demo mode, misses listed
//   --only-missing  answers already recorded are replayed instead of paid for again
//
// About 75 small claude-haiku-5-5 calls. Each writes a usage_log row (see /admin/usage).

import "./lib/env";
import { wallNow } from "@/lib/clock";
import { demoClock } from "@/lib/clock-server";
import { getAskExamples } from "@/lib/ask-examples";
import { actAs, buildDemoAsk, deleteDemoAsk, type DemoOwner, loadDemoUser, markGuidedSent, readDemoState, resetDemo } from "@/lib/demo";
import type { DemoAskDef } from "@/lib/demo-script";
import { createLogger } from "@/lib/log";
import { resolveScriptMode } from "@/lib/mode";
import { type LiveRecord, runAsScript, type ScriptRun } from "@/lib/model";
import { isRecordedPurpose, type RecordedEntry, type RecordedPurpose, rememberRecorded } from "@/lib/model-fixtures";
import { getRampView } from "@/lib/ramp";
import { defaultPersonaId } from "@/lib/viewer";
import { writeFixtureEntries } from "./lib/fixture-files";
import { runScript } from "./lib/run";

const log = createLogger("fixtures.record");

type Tally = Record<string, { recorded: number; deterministic: number; misses: string[] }>;

function tallyRun(tally: Tally): ScriptRun["onFixture"] {
  return (f) => {
    const s = (tally[f.purpose] ??= { recorded: 0, deterministic: 0, misses: [] });
    s[f.kind]++;
    if (f.kind === "deterministic" && f.hash) s.misses.push(f.hash);
  };
}

const visitorId = () => `vis_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

await runScript("fixtures-record", async (args) => {
  const dryRun = args.includes("--dry-run");
  const onlyMissing = args.includes("--only-missing");
  const mode = resolveScriptMode("fixtures:record", dryRun ? "demo" : "auto");
  if (!dryRun && mode.mode !== "live") throw new Error("ANTHROPIC_API_KEY is not set, so there is nothing to record. Set it in .env.local, or rehearse with --dry-run.");
  log.info(`${dryRun ? "DRY RUN (demo mode, nothing written)" : "recording LIVE answers"}${onlyMissing ? ", replaying answers already recorded" : ""}`);

  const records = new Map<string, LiveRecord>();
  const tally: Tally = {};
  const examples = await getAskExamples();
  const visitorPersona = await defaultPersonaId();
  if (!visitorPersona) throw new Error("no default persona (newhire_web) in seed.planted: run pnpm db:reset first");
  const exampleDef = (e: (typeof examples)[number]): DemoAskDef => ({ key: `example_${e.id}`, body: e.body, tried: e.tried, urgency: e.urgency, outcome: { kind: "ready" }, daysAgo: 0 });

  const run: ScriptRun = {
    actor: { kind: "script", name: "fixtures:record" },
    preferRecorded: onlyMissing,
    onFixture: tallyRun(tally),
    record: (r) => {
      records.set(`${r.purpose}:${r.hash}`, r);
      if (isRecordedPurpose(r.purpose)) rememberRecorded(r.purpose, toEntry(r));
    },
  };

  await runAsScript(run, async () => {
    // phase 1: right after a reset
    await resetDemo("pnpm fixtures:record", { mode });
    const state = await readDemoState();
    if (!state) throw new Error("the reset left no demo state");
    const user = await loadDemoUser(state.accountId);
    const clock = await demoClock("fixtures:record");
    const runExamples = async (phase: string) => {
      for (const e of examples) {
        const owners: Array<[string, DemoOwner]> = [
          ["demo account", { user, visitorId: null, personaId: state.personaId }],
          ["signed-out visitor", { user: null, visitorId: visitorId(), personaId: visitorPersona }],
        ];
        for (const [who, owner] of owners) {
          const ref = await actAs({ user: owner.user, mode, clock }, () => buildDemoAsk(exampleDef(e), owner));
          log.info(`${phase}: example ${e.id} as ${who} -> ${ref.askId} ${ref.state}${ref.recipientId ? ` for ${ref.recipientId}` : ""}`);
          await deleteDemoAsk(ref.askId);
        }
      }
    };
    await runExamples("phase 1");

    // phase 2: after the guided send
    const sent = await markGuidedSent(state);
    log.info(`phase 2: guided ${state.guidedAskId} marked sent (load ${sent.loadBefore} -> ${sent.loadAfter})`);
    await actAs({ user, mode, clock }, () => getRampView("this"));
    await runExamples("phase 2");
  });

  const byPurpose: Partial<Record<RecordedPurpose, RecordedEntry[]>> = {};
  for (const r of records.values()) if (isRecordedPurpose(r.purpose)) (byPurpose[r.purpose] ??= []).push(toEntry(r));
  const tokens = [...records.values()].reduce((n, r) => n + r.usage.inputTokens + r.usage.outputTokens, 0);
  for (const [p, s] of Object.entries(tally)) log.info(`while recording, ${p}: ${s.recorded} replayed from recordings, ${s.deterministic} fell back to the deterministic path${s.deterministic && !dryRun ? " (live call refused or failed: see the gate lines above)" : ""}`);
  if (dryRun) {
    log.info(`dry run: would record about ${Object.values(tally).reduce((n, s) => n + s.deterministic, 0)} answers; nothing written`);
  } else {
    const written = await writeFixtureEntries(byPurpose);
    log.info(`wrote ${records.size} live answers (${tokens} tokens) to fixtures/model: ${JSON.stringify(written)}. Commit fixtures/model/ so demo mode replays them.`);
  }

  // Replay check: what a judge gets after Reset demo, in demo mode.
  const replay: Tally = {};
  await runAsScript({ actor: { kind: "script", name: "fixtures:record replay" }, onFixture: tallyRun(replay) }, () => resetDemo("pnpm fixtures:record (replay check)"));
  for (const [p, s] of Object.entries(replay)) log.info(`replay after Reset demo, ${p}: ${s.recorded} recorded, ${s.deterministic} deterministic${s.misses.length ? ` (misses ${s.misses.join(", ")})` : ""}`);
  const missed = Object.values(replay).reduce((n, s) => n + s.deterministic, 0);
  if (!dryRun && missed) {
    log.warn(`${missed} demo results after a reset still miss the recordings; the inputs changed between recording and replay (see the misses above)`);
    process.exitCode = 1;
  }
});

/**
 * The repo rule (pnpm check scans fixtures/) bans dashes and emoji in committed data. The app
 * already turns a model's dashes into commas before showing them; the stored copy gets the same,
 * and emoji are dropped, so a recording never fails the check.
 */
function cleanStrings(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\p{Extended_Pictographic}\uFE0F?/gu, "");
  if (Array.isArray(v)) return v.map(cleanStrings);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanStrings(x)]));
  return v;
}

function toEntry(r: LiveRecord): RecordedEntry {
  return { hash: r.hash, label: r.label, recordedAt: wallNow().toISOString(), model: r.model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, output: cleanStrings(r.output), tier: r.tier, ms: r.ms };
}
