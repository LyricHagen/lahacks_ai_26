"use client";
// Client logger with the same shape as the server one:
//
//   const log = createLogger("ask.compose");
//   log.info("submitted", { chars: 140 });
//
// Lines go to the browser console and to the debug drawer. The request id slot shows
// `client`, or the server request id when the line is about a specific API call.

import { pushEntries } from "./debug-store";
import { type Level, type LogContext, formatLine, serializeError } from "./log-format";

export type ClientLogger = {
  trace(msg: string, ctx?: LogContext): void;
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext & { err?: unknown }): void;
  branch(chose: string, reason: string, ctx?: LogContext): void;
  skip(what: string, reason: string, ctx?: LogContext): void;
  /** Same logger, but lines carry this request id instead of `client`. */
  forRequest(reqId: string): ClientLogger;
};

// Keep a handle on the real console so the console capture in DebugProvider cannot loop.
const rawConsole = typeof console !== "undefined" ? { log: console.log, warn: console.warn, error: console.error } : null;

export function writeClientLine(level: Level, scope: string, msg: string, ctx?: LogContext, reqId = "client"): string {
  const fixed = ctx && "err" in ctx ? { ...ctx, err: serializeError(ctx.err) } : ctx;
  const line = formatLine({ time: new Date(), reqId, scope, level, msg, ctx: fixed });
  pushEntries("client", [line]);
  if (rawConsole) {
    if (level === "error") rawConsole.error(line);
    else if (level === "warn") rawConsole.warn(line);
    else rawConsole.log(line);
  }
  return line;
}

export function createLogger(scope: string, reqId = "client"): ClientLogger {
  const w = (level: Level) => (msg: string, ctx?: LogContext) => void writeClientLine(level, scope, msg, ctx, reqId);
  return {
    trace: w("trace"),
    debug: w("debug"),
    info: w("info"),
    warn: w("warn"),
    error: w("error"),
    branch: (chose, reason, ctx) => writeClientLine("debug", scope, `branch: ${chose} (because ${reason})`, ctx, reqId),
    skip: (what, reason, ctx) => writeClientLine("info", scope, `skipped: ${what} (because ${reason})`, ctx, reqId),
    forRequest: (id) => createLogger(scope, id),
  };
}
