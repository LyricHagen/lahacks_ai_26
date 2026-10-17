import "server-only";
// Daily token budgets for live model calls, from env vars. A day is the UTC calendar day.
// Tokens are input plus output tokens of live calls in usage_log (fallbacks record zero).

import { and, eq, gte, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { createLogger } from "./log";

const log = createLogger("model.budget");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    log.warn(`${name}=${raw} is not a non-negative integer, using default ${fallback}`);
    return fallback;
  }
  return n;
}

export function budgetLimits() {
  return {
    userDailyTokens: envInt("USER_DAILY_TOKEN_BUDGET", 50_000),
    globalDailyTokens: envInt("GLOBAL_DAILY_TOKEN_BUDGET", 500_000),
  };
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type BudgetState = {
  dayStart: string;
  userUsed: number | null;
  userLimit: number;
  globalUsed: number;
  globalLimit: number;
};

/** Tokens used today by this user (null when there is no user) and by everyone. One query. */
export async function getBudgetState(userId: string | null): Promise<BudgetState> {
  const limits = budgetLimits();
  const day = startOfUtcDay();
  const [row] = await q("model.budget.today", (db) =>
    db
      .select({
        globalUsed: sql<number>`coalesce(sum(${t.usageLog.inputTokens} + ${t.usageLog.outputTokens}), 0)::int`,
        userUsed: userId
          ? sql<number>`coalesce(sum(${t.usageLog.inputTokens} + ${t.usageLog.outputTokens}) filter (where ${t.usageLog.userId} = ${userId}), 0)::int`
          : sql<null>`null`,
      })
      .from(t.usageLog)
      .where(and(gte(t.usageLog.createdAt, day), eq(t.usageLog.outcome, "live"))),
  );
  return {
    dayStart: day.toISOString(),
    userUsed: row?.userUsed ?? (userId ? 0 : null),
    userLimit: limits.userDailyTokens,
    globalUsed: row?.globalUsed ?? 0,
    globalLimit: limits.globalDailyTokens,
  };
}
