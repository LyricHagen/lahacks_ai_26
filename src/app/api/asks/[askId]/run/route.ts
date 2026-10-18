import { runAskPipeline } from "@/lib/ask-pipeline";
import { assertAskAccess } from "@/lib/asks";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ParamSchemas } from "@/lib/inputs";
import { fail, ok, parseParams, withRoute } from "@/lib/request-context";

/**
 * Runs the ask's processing steps inside this request. The ask page calls it once and polls
 * GET /api/asks/[askId] meanwhile for the status line. A second caller gets "already running".
 * Rate limited per IP and per owner (account or visitor), since every step may call a model.
 */
export const POST = withRoute<{ askId: string }>("ask.run", async (_req, { params }) => {
  const { askId } = parseParams(ParamSchemas.askId, await params, "ask.run");
  const { viewer, ask } = await assertAskAccess(askId);
  if (ask.source === "seed") fail("FORBIDDEN", "Seeded history is read only.", 403);
  await enforceRateLimit("ask_run");
  await enforceRateLimit("ask_run_owner", viewer.actorId);
  const r = await runAskPipeline(askId);
  return ok({ ...r });
});
