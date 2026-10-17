// Server ring buffer (last 500 lines) for /debug. Development or admin only.

import { createLogger, ringLines, ringRequestIds } from "@/lib/log";
import { fail, isDebugAllowed, ok, withRoute } from "@/lib/request-context";

const log = createLogger("debug.logs");

export const GET = withRoute("debug.logs", async (req) => {
  if (!(await isDebugAllowed())) {
    log.warn("ring buffer request refused", { reason: "production and caller is not an admin" });
    fail("DEBUG_FORBIDDEN", undefined, 403);
  }
  const reqId = req.nextUrl.searchParams.get("reqId") ?? undefined;
  log.branch(reqId ? "single request" : "whole buffer", reqId ? "reqId query param present" : "no reqId param");
  // Snapshot before this handler's own exit lines land, so the payload is stable.
  const lines = ringLines(reqId);
  log.debug(`returning ${lines.length} ring lines`, { reqId });
  return ok({ ok: true, lines, requestIds: ringRequestIds() });
});
