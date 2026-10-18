import "server-only";
// Read model for /admin/models: the committed understand_ask eval (data/understand/eval/results.json,
// written by pnpm train:eval) and live per-tier latency and cost from usage_log.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { wallMs } from "./clock";
import { createLogger } from "./log";
import { VERI_DEFAULTS, veriTimeoutMs, veriUnavailable } from "./model-veri";

const log = createLogger("admin.models");

export type TierStat = { origin: "app" | "script"; purpose: string; tier: string; provider: string; model: string; calls: number; p50: number; p95: number; avgCostUsd: number; costUsd: number; lastAt: Date };
export type TierFailure = { at: Date; purpose: string; tier: string; note: string; reqId: string | null };

/** Same shape scripts/train/eval.ts writes; kept loose so an older file still renders. */
export type EvalFile = {
  generatedAt: string;
  promptVersion: string;
  testN: number;
  heldoutN: number;
  notes: string[];
  systems: Array<{
    system: string;
    label: string;
    model: string;
    test: { n: number; validity: number; entityF1: number; fieldF1: Record<string, number>; helpKindAcc: number; urgencyAcc: number; sensitiveRecall: number; p50: number; p95: number; costPer1k: number };
    byCategory: Record<string, { n: number; entityF1: number; validity: number; sensitiveRecall: number }>;
    heldout: { n: number; validity: number; entityF1: number; fieldF1: Record<string, number>; sensitiveRecall: number } | null;
  }>;
};

export async function readEvalResults(): Promise<EvalFile | null> {
  const path = join(process.cwd(), "data", "understand", "eval", "results.json");
  try {
    const r = JSON.parse(await readFile(path, "utf8")) as EvalFile;
    log.info(`eval results from ${r.generatedAt}: ${r.systems.length} systems, ${r.testN} test examples`);
    return r;
  } catch (err) {
    log.skip("eval table", `no readable ${path} (${(err as Error).message}); run pnpm train:eval`);
    return null;
  }
}

/**
 * Owner scripts (the eval, fixtures:record, train:generate) are the only live rows without a user:
 * an app call needs an approved account to be live. They are reported apart so an eval run does not
 * read as product traffic, and they never appear under fallbacks.
 */
const ORIGIN = sql<"app" | "script">`case when ${t.usageLog.userId} is null and ${t.usageLog.mode} = 'live' then 'script' else 'app' end`;

export async function getTierReport(days = 7) {
  const since = new Date(wallMs() - days * 86_400_000).toISOString();
  const [stats, failures] = await Promise.all([
    q("admin.models.tiers", (db) =>
      db
        .select({
          origin: ORIGIN,
          purpose: t.usageLog.purpose,
          tier: sql<string>`coalesce(${t.usageLog.tier}, 'untracked')`,
          provider: sql<string>`coalesce(${t.usageLog.provider}, 'unknown')`,
          model: t.usageLog.model,
          calls: sql<number>`count(*)::int`,
          p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${t.usageLog.latencyMs}), 0)::float8`,
          p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${t.usageLog.latencyMs}), 0)::float8`,
          avgCostUsd: sql<number>`coalesce(avg(${t.usageLog.costUsd}), 0)::float8`,
          costUsd: sql<number>`coalesce(sum(${t.usageLog.costUsd}), 0)::float8`,
          lastAt: sql<Date>`max(${t.usageLog.createdAt})`,
        })
        .from(t.usageLog)
        .where(sql`${t.usageLog.createdAt} >= ${since}::timestamptz`)
        .groupBy(ORIGIN, t.usageLog.purpose, t.usageLog.tier, t.usageLog.provider, t.usageLog.model)
        .orderBy(t.usageLog.purpose, sql`count(*) desc`),
    ),
    q("admin.models.failures", (db) =>
      db
        .select({ at: t.usageLog.createdAt, purpose: t.usageLog.purpose, tier: sql<string>`coalesce(${t.usageLog.tier}, '')`, note: sql<string>`coalesce(${t.usageLog.tierNote}, '')`, reqId: t.usageLog.reqId })
        .from(t.usageLog)
        .where(sql`${t.usageLog.createdAt} >= ${since}::timestamptz and ${t.usageLog.tierNote} like '%failed%' and ${ORIGIN} = 'app'`)
        .orderBy(sql`${t.usageLog.createdAt} desc`)
        .limit(20),
    ),
  ]);
  log.info(`tier report: ${stats.filter((s) => s.origin === "app").length} app and ${stats.filter((s) => s.origin === "script").length} script purpose/tier rows, ${failures.length} recent app tier failures over ${days} days`);
  return {
    days,
    stats: stats.map((s) => ({ ...s, lastAt: new Date(s.lastAt) })) as TierStat[],
    failures: failures as TierFailure[],
    veri: { unavailable: veriUnavailable(), deployment: process.env.VERI_UNDERSTAND_DEPLOYMENT ?? null, model: process.env.VERI_UNDERSTAND_MODEL ?? VERI_DEFAULTS.model, timeoutMs: veriTimeoutMs() },
  };
}
