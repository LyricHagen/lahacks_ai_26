import "server-only";
// App time for the current request: pinned in demo mode, real otherwise. Memoized per request, so
// every part of one page or one pipeline run sees the same instant and the decision is logged once:
//
//   [clock] INFO clock=pinned now=2026-10-19T17:20:00.000Z (Mon, Oct 19, 10:20 Pacific): mode demo (signed_out), pinned ...

import type { AppClock } from "./clock";
import { systemClock } from "./clock";
import { demoClock, logClock } from "./clock-server";
import { currentRequest } from "./log";
import { currentMode } from "./mode-request";

export const CLOCK_MEMO_KEY = "clock";
const MEMO_KEY = CLOCK_MEMO_KEY;

export async function getClock(): Promise<AppClock> {
  const store = currentRequest();
  if (store?.memo?.has(MEMO_KEY)) return store.memo.get(MEMO_KEY) as AppClock;
  const mode = await currentMode();
  let c: AppClock;
  if (mode.mode === "demo") {
    c = await demoClock(`mode demo (${mode.reason})`);
  } else {
    c = systemClock(`mode live (${mode.reason}), real time`);
    logClock(c);
  }
  if (store) (store.memo ??= new Map()).set(MEMO_KEY, c);
  return c;
}
