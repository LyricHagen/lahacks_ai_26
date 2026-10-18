// Called by PageLoadLogger on every client navigation, so each page load produces a server
// line with a request id. This is the "demo log line" that proves the pipeline end to end.

import { createLogger } from "@/lib/log";
import { QuerySchemas } from "@/lib/inputs";
import { ok, parseQuery, withRoute } from "@/lib/request-context";

const log = createLogger("debug.ping");

export const GET = withRoute("debug.ping", async (req) => {
  const path = parseQuery(QuerySchemas["debug.ping"], req, "debug.ping").path ?? "(unknown)";
  log.info(`page load ${path}`, { path, ua: req.headers.get("user-agent")?.slice(0, 60) });
  return ok({ ok: true, path });
});
