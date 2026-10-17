import "server-only";
// Read model for /admin/usage: spend from usage_log, by user and by purpose, today and all time.

import { desc, eq, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { startOfUtcDay } from "./budget";
import { createLogger } from "./log";

const log = createLogger("admin.usage");

export type SpendTotals = { calls: number; live: number; fallbacks: number; tokens: number; costUsd: number };
export type SpendRow = SpendTotals & { key: string; label: string | null; todayTokens: number; todayCostUsd: number };
export type RecentCall = {
  id: number;
  createdAt: Date;
  userId: string | null;
  email: string | null;
  purpose: string;
  model: string;
  mode: string;
  outcome: string;
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number | null;
  reqId: string | null;
};

const totalsCols = {
  calls: sql<number>`count(*)::int`,
  live: sql<number>`(count(*) filter (where ${t.usageLog.outcome} = 'live'))::int`,
  fallbacks: sql<number>`(count(*) filter (where ${t.usageLog.outcome} <> 'live'))::int`,
  tokens: sql<number>`coalesce(sum(${t.usageLog.inputTokens} + ${t.usageLog.outputTokens}), 0)::int`,
  costUsd: sql<number>`coalesce(sum(${t.usageLog.costUsd}), 0)::float8`,
};

export async function getUsageReport() {
  const day = startOfUtcDay();
  // Raw sql templates pass params straight to the driver, which does not serialize Date objects.
  const dayIso = day.toISOString();
  const todayCols = {
    todayTokens: sql<number>`coalesce(sum(${t.usageLog.inputTokens} + ${t.usageLog.outputTokens}) filter (where ${t.usageLog.createdAt} >= ${dayIso}::timestamptz), 0)::int`,
    todayCostUsd: sql<number>`coalesce(sum(${t.usageLog.costUsd}) filter (where ${t.usageLog.createdAt} >= ${dayIso}::timestamptz), 0)::float8`,
  };
  const [today, allTime, byUser, byPurpose, recent] = await Promise.all([
    q("admin.usage.today", (db) => db.select(totalsCols).from(t.usageLog).where(sql`${t.usageLog.createdAt} >= ${dayIso}::timestamptz`)),
    q("admin.usage.all_time", (db) => db.select(totalsCols).from(t.usageLog)),
    q("admin.usage.by_user", (db) =>
      db
        .select({ key: sql<string>`coalesce(${t.usageLog.userId}, 'none')`, label: t.users.email, ...totalsCols, ...todayCols })
        .from(t.usageLog)
        .leftJoin(t.users, eq(t.users.id, t.usageLog.userId))
        .groupBy(t.usageLog.userId, t.users.email)
        .orderBy(desc(totalsCols.costUsd), desc(totalsCols.calls)),
    ),
    q("admin.usage.by_purpose", (db) =>
      db
        .select({ key: t.usageLog.purpose, label: sql<string | null>`null`, ...totalsCols, ...todayCols })
        .from(t.usageLog)
        .groupBy(t.usageLog.purpose)
        .orderBy(desc(totalsCols.costUsd), desc(totalsCols.calls)),
    ),
    q("admin.usage.recent", (db) =>
      db
        .select({
          id: t.usageLog.id,
          createdAt: t.usageLog.createdAt,
          userId: t.usageLog.userId,
          email: t.users.email,
          purpose: t.usageLog.purpose,
          model: t.usageLog.model,
          mode: t.usageLog.mode,
          outcome: t.usageLog.outcome,
          errorCode: t.usageLog.errorCode,
          inputTokens: t.usageLog.inputTokens,
          outputTokens: t.usageLog.outputTokens,
          latencyMs: t.usageLog.latencyMs,
          costUsd: sql<number | null>`${t.usageLog.costUsd}::float8`,
          reqId: t.usageLog.reqId,
        })
        .from(t.usageLog)
        .leftJoin(t.users, eq(t.users.id, t.usageLog.userId))
        .orderBy(desc(t.usageLog.createdAt), desc(t.usageLog.id))
        .limit(50),
    ),
  ]);
  log.info(`usage report: ${allTime[0].calls} calls all time, ${today[0].calls} today`, { costUsd: allTime[0].costUsd, todayCostUsd: today[0].costUsd });
  return { dayStart: day, today: today[0] as SpendTotals, allTime: allTime[0] as SpendTotals, byUser: byUser as SpendRow[], byPurpose: byPurpose as SpendRow[], recent: recent as RecentCall[] };
}
