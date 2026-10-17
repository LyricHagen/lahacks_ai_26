// pnpm db:reset [seed-string]
// Drops everything (public and drizzle schemas, including accounts), runs every migration,
// then seeds. Logs counts per table at the end. Refuses to run against a production
// deployment unless ALLOW_DB_RESET=1 is set.

import "./lib/env";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb, q } from "@/db";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { DEFAULT_SEED } from "@/seed/fixture";
import { seedDatabase } from "@/seed/load";
import { runScript } from "./lib/run";

const log = createLogger("db.reset");

await runScript("db-reset", async (args) => {
  const seed = args.find((a) => !a.startsWith("--")) ?? DEFAULT_SEED;
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "unparseable";
    }
  })();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (!local && process.env.ALLOW_DB_RESET !== "1") {
    log.error("refusing to reset a non-local database", { host, fix: "set ALLOW_DB_RESET=1 if you really mean it" });
    throw new AppError("FORBIDDEN", `db:reset refuses to drop ${host} without ALLOW_DB_RESET=1`);
  }
  log.branch(local ? "reset local database" : "reset remote database", local ? "host is localhost" : "ALLOW_DB_RESET=1 is set", { host });

  await log.timed("drop schemas", () =>
    q("reset.drop", (db) => db.execute(sql`drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;`)),
  );
  await log.timed("run migrations", () => migrate(getDb(), { migrationsFolder: "drizzle" }), { folder: "drizzle" });
  const tables = await q("reset.tables", (db) =>
    db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`),
  );
  log.info(`migrations applied, ${tables[0]?.n ?? 0} tables in public`);

  const summary = await seedDatabase(seed);
  log.info("reset complete", { seed: summary.seed, ms: summary.totalMs, counts: summary.counts });
});
