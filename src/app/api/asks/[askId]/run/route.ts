import { runAskPipeline } from "@/lib/ask-pipeline";
import { assertAskAccess } from "@/lib/asks";
import { fail, ok, withRoute } from "@/lib/request-context";

/**
 * Runs the ask's processing steps inside this request. The ask page calls it once and polls
 * GET /api/asks/[askId] meanwhile for the status line. A second caller gets "already running".
 */
export const POST = withRoute<{ askId: string }>("ask.run", async (_req, { params }) => {
  const { askId } = await params;
  const { ask } = await assertAskAccess(askId);
  if (ask.source === "seed") fail("FORBIDDEN", "Seeded history is read only.", 403);
  const r = await runAskPipeline(askId);
  return ok({ ...r });
});
