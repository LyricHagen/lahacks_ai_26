// Deliberately fails, to check the error path end to end: stack in the log, code in the UI.
// GET /api/debug/fail?code=RANK_TIMEOUT

import { AppError, isErrorCode } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { QuerySchemas } from "@/lib/inputs";
import { fail, isDebugAllowed, parseQuery, withRoute } from "@/lib/request-context";

const log = createLogger("debug.fail");

export const GET = withRoute("debug.fail", async (req) => {
  if (!(await isDebugAllowed())) fail("DEBUG_FORBIDDEN", undefined, 403);
  const raw = parseQuery(QuerySchemas["debug.fail"], req, "debug.fail").code ?? "RANK_TIMEOUT";
  const code = isErrorCode(raw) ? raw : "UNKNOWN";
  log.branch(`throw ${code}`, raw === code ? "code param is a known ErrorCode" : `unknown code param "${raw}"`);
  throw new AppError(code, `Deliberate failure for testing (${code})`, { status: 500, context: { requested: raw } });
});
