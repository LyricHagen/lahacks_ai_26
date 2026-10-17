import "server-only";
// Per-IP fixed-window rate limits for signup and login, counted in Postgres (rate_limits) so they
// hold across serverless instances. One upsert per attempt.

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { q } from "@/db";
import { AppError } from "./errors";
import { createLogger } from "./log";

const log = createLogger("auth.ratelimit");

export const RATE_LIMITS = {
  signup: { limit: 5, windowS: 60 * 60 },
  login: { limit: 10, windowS: 15 * 60 },
} as const;

export type RateBucket = keyof typeof RATE_LIMITS;

/** Client IP from the proxy headers. Vercel sets x-forwarded-for; local dev may have none. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip") || "unknown";
}

/** Count one attempt. Throws RATE_LIMITED (429) once the window's limit is exceeded. */
export async function enforceRateLimit(bucket: RateBucket): Promise<void> {
  const { limit, windowS } = RATE_LIMITS[bucket];
  const ip = await clientIp();
  const key = `${bucket}:${ip}`;
  const rows = await q(`ratelimit.${bucket}`, (db) =>
    db.execute<{ count: number; window_start: string }>(sql`
      insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when rate_limits.window_start < now() - make_interval(secs => ${windowS}) then 1 else rate_limits.count + 1 end,
        window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowS}) then now() else rate_limits.window_start end
      returning count, window_start`),
  );
  const count = Number(rows[0]?.count ?? 1);
  const resetsAt = new Date(new Date(rows[0]?.window_start ?? Date.now()).getTime() + windowS * 1000);
  if (count > limit) {
    log.warn(`rate limit: deny ${bucket} from ${ip} (${count} attempts, limit ${limit} per ${windowS}s, resets ${resetsAt.toISOString()})`, { bucket, ip, count, limit });
    throw new AppError("RATE_LIMITED", undefined, { status: 429, context: { bucket, resetsAt: resetsAt.toISOString() } });
  }
  log.debug(`rate limit: allow ${bucket} from ${ip} (${count} of ${limit} in this window)`, { bucket, ip, count, limit });
}
