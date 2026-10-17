// Health check: app is up, database reachable, pgvector installed.

import { sql } from "drizzle-orm";
import { q } from "@/db";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { ok, withRoute } from "@/lib/request-context";

const log = createLogger("health");

export const GET = withRoute("health", async () => {
  if (!process.env.DATABASE_URL) {
    log.skip("database check", "DATABASE_URL is not set");
    return ok({ ok: true, db: "not_configured" });
  }
  try {
    const rows = await q("health.pgvector", (db) =>
      db.execute<{ extversion: string }>(sql`select extversion from pg_extension where extname = 'vector'`),
    );
    const version = rows[0]?.extversion ?? null;
    if (!version) log.warn("pgvector extension missing; run pnpm db:migrate");
    return ok({ ok: true, db: "up", pgvector: version });
  } catch (err) {
    if (err instanceof AppError && err.code === "DB_UNAVAILABLE") {
      log.branch("report db down", "connection failed; is docker compose up?");
      return ok({ ok: false, db: "down", error: { code: err.code, message: err.message } }, 503);
    }
    throw err;
  }
});
