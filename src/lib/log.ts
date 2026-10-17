// Server logger. See DEBUGGING.md for the conventions every caller must follow.
//
//   const log = createLogger("ask.rank");
//   log.info("scored 24 candidates in 81ms", { askId, top });
//
// The request id comes from AsyncLocalStorage (set by withRoute / withAction / withPage in
// src/lib/request-context.ts), so it never has to be passed around by hand.

import { AsyncLocalStorage } from "node:async_hooks";
import {
  type Level,
  type LogContext,
  formatLine,
  levelRank,
  parseLevel,
  serializeError,
} from "./log-format";

export type RequestStore = {
  reqId: string;
  method?: string;
  path?: string;
  startedAt: number;
  /** Every line written while this store is active, used for the `_debug` array. */
  lines: string[];
  /** Per-request memo (the session user, so it is looked up once per request). */
  memo?: Map<string, unknown>;
};

const RING_SIZE = 500;

type RingEntry = { reqId: string; line: string };

type LogGlobals = {
  als: AsyncLocalStorage<RequestStore>;
  ring: RingEntry[];
  secrets: string[] | null;
};

// globalThis so the proxy bundle, route handlers and HMR reloads all share one buffer.
const G = globalThis as unknown as { __w2aLog?: LogGlobals };
const globals: LogGlobals = (G.__w2aLog ??= {
  als: new AsyncLocalStorage<RequestStore>(),
  ring: [],
  secrets: null,
});

export const requestStorage = globals.als;

export function currentRequest(): RequestStore | undefined {
  return globals.als.getStore();
}

export function currentReqId(): string {
  return globals.als.getStore()?.reqId ?? "req_none";
}

const minLevel: Level = parseLevel(
  process.env.LOG_LEVEL,
  process.env.NODE_ENV === "production" ? "debug" : "trace",
);

/** Exact values of env vars that look secret, so they are scrubbed even if they match no pattern. */
function knownSecrets(): string[] {
  if (globals.secrets) return globals.secrets;
  const out: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || v.length < 8) continue;
    if (/KEY|SECRET|TOKEN|PASSWORD|PRIVATE|DATABASE_URL|CREDENTIAL/i.test(k)) out.push(v);
  }
  globals.secrets = out;
  return out;
}

function write(level: Level, scope: string, msg: string, ctx?: LogContext): string | null {
  if (levelRank(level) < levelRank(minLevel)) return null;
  const store = globals.als.getStore();
  const reqId = store?.reqId ?? "req_none";
  const line = formatLine({ time: new Date(), reqId, scope, level, msg, ctx }, knownSecrets());

  globals.ring.push({ reqId, line });
  if (globals.ring.length > RING_SIZE) globals.ring.splice(0, globals.ring.length - RING_SIZE);
  store?.lines.push(line);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  return line;
}

export type Logger = {
  scope: string;
  trace(msg: string, ctx?: LogContext): void;
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  /** Pass the caught value as `err`; its name, message, code and full stack are logged. */
  error(msg: string, ctx?: LogContext & { err?: unknown }): void;
  /** Log that a branch was taken, and why. */
  branch(chose: string, reason: string, ctx?: LogContext): void;
  /** Log that something was skipped, and why. */
  skip(what: string, reason: string, ctx?: LogContext): void;
  /** Run fn, logging entry, exit with duration, and failure with stack. Rethrows. */
  timed<T>(label: string, fn: () => Promise<T>, ctx?: LogContext, summarize?: (r: T) => LogContext): Promise<T>;
  child(sub: string): Logger;
};

export function createLogger(scope: string): Logger {
  const logger: Logger = {
    scope,
    trace: (m, c) => void write("trace", scope, m, c),
    debug: (m, c) => void write("debug", scope, m, c),
    info: (m, c) => void write("info", scope, m, c),
    warn: (m, c) => void write("warn", scope, m, c),
    error: (m, c) => {
      if (c && "err" in c) {
        const { err, ...rest } = c;
        write("error", scope, m, { ...rest, err: serializeError(err) });
      } else {
        write("error", scope, m, c);
      }
    },
    branch: (chose, reason, c) => void write("debug", scope, `branch: ${chose} (because ${reason})`, c),
    skip: (what, reason, c) => void write("info", scope, `skipped: ${what} (because ${reason})`, c),
    async timed(label, fn, ctx, summarize) {
      const t0 = performance.now();
      write("debug", scope, `${label} start`, ctx);
      try {
        const result = await fn();
        const ms = Math.round(performance.now() - t0);
        write("debug", scope, `${label} done in ${ms}ms`, { ...ctx, ms, ...(summarize ? summarize(result) : {}) });
        return result;
      } catch (err) {
        const ms = Math.round(performance.now() - t0);
        write("error", scope, `${label} failed after ${ms}ms`, { ...ctx, ms, err: serializeError(err) });
        throw err;
      }
    },
    child: (sub) => createLogger(`${scope}.${sub}`),
  };
  return logger;
}

// ---------------------------------------------------------------------------
// Ring buffer access, for /api/debug/logs and the /debug page.
// ---------------------------------------------------------------------------

export function ringLines(reqId?: string): string[] {
  const src = reqId ? globals.ring.filter((e) => e.reqId === reqId) : globals.ring;
  return src.map((e) => e.line);
}

export function ringRequestIds(): string[] {
  const ids: string[] = [];
  for (const e of globals.ring) if (!ids.includes(e.reqId)) ids.push(e.reqId);
  return ids;
}
