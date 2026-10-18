// pnpm preflight
//
// Run before judging. Checks the database, migrations, seed, fixtures, keys, budgets, the
// fine-tune tier and the guided demo, and prints one pass/warn/fail table. Exit code 1 on any
// FAIL; WARN means the app works but something is degraded (for example demo mode only).
// Read only: it never writes to the database and never calls a model (the Veri check is a GET of
// the deployment's status, which does not wake it).

import "./lib/env";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { q } from "@/db";
import { wallMs } from "@/lib/clock";
import { budgetLimits, getBudgetState } from "@/lib/budget";
import { createLogger } from "@/lib/log";
import { recordedCounts } from "@/lib/model-fixtures";
import { MODEL_PRICES } from "@/lib/model-log";
import { veriUnavailable } from "@/lib/model-veri";
import { runScript } from "./lib/run";

const log = createLogger("preflight");
type Row = { check: string; status: "PASS" | "WARN" | "FAIL"; detail: string };

await runScript("preflight", async () => {
  const rows: Row[] = [];
  const add = (check: string, status: Row["status"], detail: string) => {
    rows.push({ check, status, detail });
    log.info(`${status} ${check}: ${detail}`);
  };
  const safe = async (check: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      add(check, "FAIL", (err as Error).message.slice(0, 160));
      log.error(`${check} threw`, { err });
    }
  };

  // Environment
  add("AUTH_SECRET", process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32 ? "PASS" : "FAIL", process.env.AUTH_SECRET ? `${process.env.AUTH_SECRET.length} chars` : "not set (sessions cannot be signed)");
  add("DATABASE_URL", process.env.DATABASE_URL ? "PASS" : "FAIL", process.env.DATABASE_URL ? "set" : "not set");
  add("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY ? "PASS" : "WARN", process.env.ANTHROPIC_API_KEY ? "set: approved accounts get live mode" : "not set: everyone gets demo mode (works, by design)");
  const veri = veriUnavailable();
  add("Fine-tune tier env", veri ? "WARN" : "PASS", veri ? `off (${veri}): understand_ask goes straight to Haiku` : `deployment ${process.env.VERI_UNDERSTAND_DEPLOYMENT}`);
  add("ADMIN_EMAILS", process.env.ADMIN_EMAILS ? "PASS" : "WARN", process.env.ADMIN_EMAILS ? "set" : "not set: only the first signup becomes admin");
  const sentry = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  add("Sentry", sentry ? "PASS" : "WARN", sentry ? "DSN set" : "SENTRY_DSN not set: errors only in the app log");

  // Database
  await safe("Database connection", async () => {
    const [r] = await q("preflight.ping", (db) => db.execute(sql`select version() as v, (select extversion from pg_extension where extname = 'vector') as vector`));
    const row = r as { v: string; vector: string | null };
    add("Database connection", "PASS", row.v.split(" ").slice(0, 2).join(" "));
    add("pgvector", row.vector ? "PASS" : "FAIL", row.vector ? `version ${row.vector}` : "extension missing (run pnpm db:migrate)");
  });
  await safe("Migrations", async () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ tag: string }> };
    const [r] = await q("preflight.migrations", (db) => db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`));
    const n = (r as { n: number }).n;
    add("Migrations", n >= journal.entries.length ? "PASS" : "FAIL", `${n} applied of ${journal.entries.length} (latest ${journal.entries.at(-1)?.tag})`);
  });
  await safe("Seed", async () => {
    const [r] = await q("preflight.seed", (db) =>
      db.execute(sql`select (select count(*)::int from employees) as people, (select count(*)::int from services) as services, (select count(*)::int from documents) as docs, (select count(*)::int from calendar_events) as events, (select value from app_meta where key = 'seed.anchor_day') as anchor, (select value from app_meta where key = 'seed.string') as seed`),
    );
    const s = r as { people: number; services: number; docs: number; events: number; anchor: string | null; seed: string | null };
    add("Seed loaded", s.people >= 200 && s.services >= 25 ? "PASS" : "FAIL", `${s.people} people, ${s.services} services, ${s.docs} docs, seed ${s.seed ?? "none"} (pnpm seed)`);
    const anchor = s.anchor ? JSON.parse(JSON.stringify(s.anchor)).toString().replace(/"/g, "") : null;
    const ageDays = anchor ? Math.max(0, Math.floor((wallMs() - Date.parse(`${anchor}T12:00:00Z`)) / 86_400_000)) : null;
    add("Calendars", s.events > 0 && ageDays !== null && ageDays <= 10 ? "PASS" : "WARN", `${s.events} events, anchor ${anchor ?? "none"}${ageDays !== null ? ` (${ageDays} days ago; demo mode pins the clock, live mode needs a reseed every ~10 days)` : ""}`);
  });
  await safe("Demo account", async () => {
    const [r] = await q("preflight.demo", (db) => db.execute(sql`select (select count(*)::int from users where is_demo) as demo, (select count(*)::int from asks where source = 'demo') as asks, (select count(*)::int from users where role = 'admin') as admins`));
    const d = r as { demo: number; asks: number; admins: number };
    add("Guided demo", d.demo === 1 && d.asks > 0 ? "PASS" : "WARN", d.demo ? `${d.asks} demo asks (press Reset demo before judging)` : "no demo account yet: open /demo and press Reset demo once");
    add("Admin account", d.admins > 0 ? "PASS" : "WARN", d.admins ? `${d.admins} admin(s)` : "none: the first signup becomes admin");
  });
  await safe("Budgets", async () => {
    const l = budgetLimits();
    const b = await getBudgetState(null);
    const left = l.globalDailyTokens - b.globalUsed;
    add("Global token budget", left > l.globalDailyTokens * 0.2 ? "PASS" : left > 0 ? "WARN" : "FAIL", `${b.globalUsed} of ${l.globalDailyTokens} tokens used today (UTC); per user ${l.userDailyTokens}`);
  });

  // Fixtures (what demo mode serves)
  await safe("Fixtures", async () => {
    const company = JSON.parse(readFileSync("fixtures/company.json", "utf8")) as { employees: unknown[] };
    add("Company fixture", company.employees.length >= 200 ? "PASS" : "FAIL", `${company.employees.length} people in fixtures/company.json`);
    for (const p of ["understand_ask", "explain_ranking", "draft_ask", "ramp_plan", "gate_check"]) JSON.parse(readFileSync(`fixtures/demo/${p}.json`, "utf8"));
    add("Demo fixtures", "PASS", "fixtures/demo: 5 purposes parse");
    const rec = recordedCounts();
    const total = Object.values(rec).reduce((a, b) => a + b, 0);
    add("Recorded live answers", total ? "PASS" : "WARN", total ? Object.entries(rec).map(([k, v]) => `${k} ${v}`).join(", ") : "none: demo results come from the deterministic builders (pnpm fixtures:record)");
    const missing = ["claude-haiku-5-5", "claude-sonnet-5-5", "altostratus-understand"].filter((m) => !MODEL_PRICES[m]);
    add("Model prices", missing.length ? "FAIL" : "PASS", missing.length ? `no price for ${missing.join(", ")}` : "every model priced");
  });
  await safe("Eval results", async () => {
    const r = JSON.parse(readFileSync("data/understand/eval/results.json", "utf8")) as { systems: Array<{ system: string }>; generatedAt: string };
    add("Eval results", r.systems.length >= 4 ? "PASS" : "WARN", `${r.systems.map((s) => s.system).join(", ")} (${r.generatedAt.slice(0, 10)})`);
  });

  // Veri deployment status (a GET; does not wake it)
  if (!veri)
    await safe("Fine-tune deployment", async () => {
      const res = await fetch(`https://api.veri.studio/v1/deployments/${process.env.VERI_UNDERSTAND_DEPLOYMENT}`, { headers: { authorization: `Bearer ${process.env.VERI_API_KEY}` }, signal: AbortSignal.timeout(10_000) });
      const d = (await res.json()) as { status?: string; error?: { message?: string } };
      const st = d.status ?? `HTTP ${res.status}`;
      add("Fine-tune deployment", st === "serving" ? "PASS" : st === "scaled_to_zero" ? "WARN" : "FAIL", st === "scaled_to_zero" ? "scaled to zero: the first ask falls to Haiku while it wakes (veri deployments wake <id>)" : st);
    });

  const w = Math.max(...rows.map((r) => r.check.length));
  const out = ["", `${"CHECK".padEnd(w)}  STATUS  DETAIL`, ...rows.map((r) => `${r.check.padEnd(w)}  ${r.status.padEnd(6)}  ${r.detail}`), ""];
  const fails = rows.filter((r) => r.status === "FAIL").length;
  const warns = rows.filter((r) => r.status === "WARN").length;
  out.push(fails ? `${fails} FAIL, ${warns} WARN: fix the FAIL rows before judging.` : `0 FAIL, ${warns} WARN: ready.${warns ? " WARN rows are degraded, not broken." : ""}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (fails) process.exitCode = 1;
});
