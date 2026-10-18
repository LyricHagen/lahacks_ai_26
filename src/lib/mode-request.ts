import "server-only";
// The request-bound half of mode resolution: the demo toggle cookie and the session user.

import { cookies } from "next/headers";
import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { getSessionUser } from "./auth";
import { createLogger, currentRequest } from "./log";
import { MODE_COOKIE, type RequestedMode, type ResolvedMode, resolveMode } from "./mode";

const log = createLogger("mode");

export async function getRequestedMode(): Promise<RequestedMode> {
  try {
    const jar = await cookies();
    return jar.get(MODE_COOKIE)?.value === "demo" ? "demo" : "auto";
  } catch (err) {
    unstable_rethrow(err);
    log.debug("no cookie store (outside a request), requested mode is auto", { err });
    return "auto";
  }
}

export const MODE_MEMO_KEY = "mode";
const MEMO_KEY = MODE_MEMO_KEY;

// React's per-render cache spans the layout and the page (separate withPage stores, one request),
// so a page render logs one `mode=` line. Outside a render (route handlers, actions) it does not
// memoize, and the request store memo below covers those.
const resolveForRender = cache(async () => resolveMode(await getSessionUser(), await getRequestedMode()));

/**
 * resolveMode for the current request: session user plus the toggle cookie. Memoized per request,
 * so the header, the clock and the pipeline share one decision and one `mode=` line.
 */
export async function currentMode(): Promise<ResolvedMode> {
  const store = currentRequest();
  if (store?.memo?.has(MEMO_KEY)) return store.memo.get(MEMO_KEY) as ResolvedMode;
  const r = await resolveForRender();
  if (store) (store.memo ??= new Map()).set(MEMO_KEY, r);
  return r;
}
