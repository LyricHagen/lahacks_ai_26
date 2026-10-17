import "server-only";
// Single DATABASE_URL works for docker-compose locally and for Neon (pooled URL) on Vercel.
//
// Every query goes through q(label, () => db.select()...) so it is logged with duration and
// row count. Drizzle's own logger additionally prints the SQL text at trace level.

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import * as schema from "./schema";

const log = createLogger("db");
const sqlLog = createLogger("db.sql");

type DbGlobals = { client?: postgres.Sql; db?: PostgresJsDatabase<typeof schema> };
const G = globalThis as unknown as { __w2aDb?: DbGlobals };
const globals: DbGlobals = (G.__w2aDb ??= {});

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (globals.db) return globals.db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    log.error("DATABASE_URL is not set; copy .env.example to .env.local");
    throw new AppError("DB_NOT_CONFIGURED", undefined, { status: 503 });
  }
  const host = safeHost(url);
  // Neon's pooler (pgbouncer) does not support prepared statements.
  const pooled = host.includes("-pooler.") || host.includes("neon.tech");
  log.info("creating postgres client", { host, prepare: !pooled, reason: pooled ? "pooled host, prepared statements off" : "direct connection" });
  globals.client = postgres(url, {
    max: process.env.VERCEL ? 1 : 10,
    prepare: !pooled,
    connect_timeout: 5,
    onnotice: (n) => log.debug("postgres notice", { message: n.message }),
  });
  globals.db = drizzle(globals.client, {
    schema,
    logger: { logQuery: (query, params) => sqlLog.trace(query.length > 600 ? `${query.slice(0, 600)}... (${query.length} chars)` : query, summarizeParams(params)) },
  });
  return globals.db;
}

/** Bulk inserts carry thousands of params and 256-dim vectors; keep trace lines readable. */
function summarizeParams(params: unknown[]): Record<string, unknown> | undefined {
  if (!params.length) return undefined;
  const short = (v: unknown) => (typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}... (${v.length} chars)` : v);
  if (params.length <= 12) return { params: params.map(short) };
  return { params: params.slice(0, 8).map(short), paramCount: params.length };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable-url";
  }
}

function rowCount(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length;
  const r = result as { count?: number; rowCount?: number } | null;
  return r?.count ?? r?.rowCount ?? undefined;
}

export type Db = PostgresJsDatabase<typeof schema>;
/** A transaction handle, as passed to db.transaction(async (tx) => ...). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Run one query with timing and row-count logging. Failures become DB_QUERY_FAILED (or DB_UNAVAILABLE). */
export async function q<T>(label: string, run: (db: Db) => Promise<T>): Promise<T> {
  return qIn(getDb(), label, run);
}

/** Same as q, but on a given handle (a transaction). Use inside db.transaction so every statement is logged. */
export async function qIn<H extends Db | Tx, T>(handle: H, label: string, run: (db: H) => Promise<T>): Promise<T> {
  const t0 = performance.now();
  log.debug(`query ${label} start`);
  try {
    const result = await run(handle);
    const ms = Math.round(performance.now() - t0);
    log.debug(`query ${label} done in ${ms}ms`, { ms, rows: rowCount(result) });
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    // Drizzle wraps the driver error, so the Postgres or socket code is usually on `cause`.
    const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    // 08xxx connection failures, 28xxx auth failures, 3D000 missing database, 57P0x shutting down.
    const unavailable =
      code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "CONNECT_TIMEOUT" || code === "ETIMEDOUT" || /^(08|28|57P0)/.test(code ?? "") || code === "3D000";
    log.error(`query ${label} failed after ${ms}ms`, { ms, pgCode: code, err });
    throw new AppError(unavailable ? "DB_UNAVAILABLE" : "DB_QUERY_FAILED", undefined, {
      status: unavailable ? 503 : 500,
      cause: err,
      context: { label },
    });
  }
}

/** Close the pool. Scripts call this so the process can exit. */
export async function closeDb(): Promise<void> {
  if (!globals.client) return;
  await globals.client.end({ timeout: 5 });
  globals.client = undefined;
  globals.db = undefined;
  log.debug("postgres client closed");
}
