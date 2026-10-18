import { getSessionUser } from "@/lib/auth";
import { createLogger } from "@/lib/log";
import { syncInbound, syncSecretOk } from "@/lib/phone";
import { enforceRateLimit } from "@/lib/rate-limit";
import { fail, ok, withRoute } from "@/lib/request-context";

const log = createLogger("photon.sync");

/**
 * Poll Photon for texts to the agent's number and act on each once (LINK, SENT, STOP). Called by the
 * /account and draft pages while they wait on a text (signed in), by pnpm photon:listen, and by any
 * scheduler holding PHOTON_SYNC_SECRET. Answers only counts, never message text.
 */
export const POST = withRoute("photon.sync", async (req) => {
  const bySecret = syncSecretOk(req.headers.get("authorization"));
  const user = bySecret ? null : await getSessionUser();
  if (!bySecret && !user) {
    log.info("auth decision: deny inbound sync (no session and no PHOTON_SYNC_SECRET)");
    fail("AUTH_REQUIRED", undefined, 401);
  }
  await enforceRateLimit("photon_sync");
  const r = await syncInbound(bySecret ? "scheduler" : `page for ${user!.id}`);
  return ok({ ...r });
});
