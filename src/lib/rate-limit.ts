import "server-only";
// Fixed-window rate limits counted in Postgres (rate_limits) so they hold across serverless
// instances. One upsert per attempt. Keys are `bucket:ip` (per network address) or
// `bucket:usr_N` / `bucket:vis_...` (per account or signed-out visitor). Everything that can reach a
// model provider is limited both ways: the run route (ask_run_*) and callModel itself (model_*,
// gate check 3/6). Per-IP limits are set high on purpose: judges at one venue share an address.

import { wallMs } from "@/lib/clock";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { q } from "@/db";
import { AppError } from "./errors";
import { createLogger } from "./log";

const log = createLogger("auth.ratelimit");

export const RATE_LIMITS = {
  signup: { limit: 5, windowS: 60 * 60 },
  login: { limit: 10, windowS: 15 * 60 },
  /** New asks, signed in or not, so a public demo cannot be used to fill the database. */
  ask: { limit: 120, windowS: 60 * 60 },
  ask_owner: { limit: 30, windowS: 60 * 60 },
  /** POST /api/asks/[askId]/run: each run is one or more steps that may call a model. */
  ask_run: { limit: 600, windowS: 60 * 60 },
  ask_run_owner: { limit: 150, windowS: 60 * 60 },
  /** Live model calls (callModel gate check 3/6). An ask makes about three. */
  model_ip: { limit: 240, windowS: 60 * 60 },
  model_user: { limit: 60, windowS: 60 * 60 },
  /** Reset demo wipes every demo ask, so a public page cannot hammer it. Plenty for a day of judging. */
  demo_reset: { limit: 60, windowS: 60 * 60 },
  /** Entering the demo signs in to the shared demo account. */
  demo_enter: { limit: 120, windowS: 60 * 60 },
} as const;

export type RateBucket = keyof typeof RATE_LIMITS;

/** Client IP from the proxy headers. Vercel sets x-forwarded-for; local dev may have none. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip") || "unknown";
}

/** Count one attempt. Throws RATE_LIMITED (429) once the window's limit is exceeded. Subject defaults to the client IP. */
export async function enforceRateLimit(bucket: RateBucket, subject?: string): Promise<void> {
  const r = await countAttempt(bucket, subject ?? (await clientIp()));
  if (!r.allowed) throw new AppError("RATE_LIMITED", undefined, { status: 429, context: { bucket, resetsAt: r.resetsAt.toISOString() } });
}

/** Count one attempt for a subject (an IP, usr_N or vis_...) and say whether it is within the limit. Never throws for the limit. */
export async function countAttempt(bucket: RateBucket, subject: string): Promise<{ allowed: boolean; count: number; limit: number; resetsAt: Date }> {
  const { limit, windowS } = RATE_LIMITS[bucket];
  const ip = subject;
  const key = `${bucket}:${subject}`;
  const rows = await q(`ratelimit.${bucket}`, (db) =>
    db.execute<{ count: number; window_start: string }>(sql`
      insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when rate_limits.window_start < now() - make_interval(secs => ${windowS}) then 1 else rate_limits.count + 1 end,
        window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowS}) then now() else rate_limits.window_start end
      returning count, window_start`),
  );
  const count = Number(rows[0]?.count ?? 1);
  const resetsAt = new Date(new Date(rows[0]?.window_start ?? wallMs()).getTime() + windowS * 1000);
  if (count > limit) {
    log.warn(`rate limit: deny ${bucket} from ${ip} (${count} attempts, limit ${limit} per ${windowS}s, resets ${resetsAt.toISOString()})`, { bucket, ip, count, limit });
    return { allowed: false, count, limit, resetsAt };
  }
  log.debug(`rate limit: allow ${bucket} from ${ip} (${count} of ${limit} in this window)`, { bucket, ip, count, limit });
  return { allowed: true, count, limit, resetsAt };
}
