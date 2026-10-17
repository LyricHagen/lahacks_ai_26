// Runs a script inside a request context, so every line carries one request id and the whole
// run can be followed with `grep req_xxxxxx`, exactly like an API request.

import { closeDb } from "@/db";
import { toAppError } from "@/lib/errors";
import { createLogger, requestStorage } from "@/lib/log";
import { shortId } from "@/lib/log-format";

export async function runScript(name: string, fn: (args: string[]) => Promise<void>): Promise<void> {
  const reqId = shortId("req");
  const log = createLogger(`script.${name}`);
  await requestStorage.run({ reqId, method: "SCRIPT", path: name, startedAt: performance.now(), lines: [] }, async () => {
    const t0 = performance.now();
    const args = process.argv.slice(2);
    log.info(`start`, { args, logLevel: process.env.LOG_LEVEL ?? "default", node: process.version });
    try {
      await fn(args);
      log.info(`done in ${Math.round(performance.now() - t0)}ms`);
    } catch (err) {
      const appErr = toAppError(err, "SEED_FAILED");
      log.error(`failed with ${appErr.code} after ${Math.round(performance.now() - t0)}ms`, { err });
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  });
}
