import "server-only";
// The request-bound half of mode resolution: the demo toggle cookie and the session user.

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getSessionUser } from "./auth";
import { createLogger } from "./log";
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

/** resolveMode for the current request: session user plus the toggle cookie. */
export async function currentMode(): Promise<ResolvedMode> {
  return resolveMode(await getSessionUser(), await getRequestedMode());
}
