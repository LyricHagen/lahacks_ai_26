import "server-only";
// THE k-anonymity threshold for /insights. Every number the page shows passes through kAnon
// first. A cell built from fewer than K_MIN_ASKS asks never renders: the page shows a plain
// "not enough data" state instead, and this logs one line per suppressed cell:
//
//   [insights.kanon] INFO k-anon SUPPRESSED topics cell "flagd, week of Oct 5": 3 asks < 5
//
// The count of a suppressed cell is in the log only (development or admins), never on the page.

import { createLogger } from "./log";

export const K_MIN_ASKS = 5;

const log = createLogger("insights.kanon");

export type KCell<T> = { shown: true; count: number; value: T } | { shown: false; count: null; value: null };

export type KStats = { shown: number; suppressed: number };

/** Show the cell only when `count` asks back it. Logs every suppression; counts land in `stats`. */
export function kAnon<T>(panel: string, cell: string, count: number, value: T, stats?: KStats): KCell<T> {
  if (count >= K_MIN_ASKS) {
    if (stats) stats.shown++;
    return { shown: true, count, value };
  }
  if (stats) stats.suppressed++;
  // An empty cell is suppressed too (a zero says something about a small group); it logs at debug to keep the log readable.
  const line = `k-anon SUPPRESSED ${panel} cell "${cell}": ${count} asks < ${K_MIN_ASKS}`;
  const ctx = { panel, cell, count, k: K_MIN_ASKS };
  if (count === 0) log.debug(line, ctx);
  else log.info(line, ctx);
  return { shown: false, count: null, value: null };
}

export function newStats(): KStats {
  return { shown: 0, suppressed: 0 };
}
