import { agentGuard } from "@/lib/agent-api";
import { assertAskAccess } from "@/lib/asks";
import { transitionAsk } from "@/lib/ask-transition";
import { wallNow } from "@/lib/clock";
import { ParamSchemas } from "@/lib/inputs";
import { fail, ok, parseParams, withRoute } from "@/lib/request-context";

/** A step failed and the ask went back to draft: submit it again (draft -> understanding), like the Try again button. Then POST .../run. */
export const POST = withRoute<{ askId: string }>("agent.ask.retry", async (req, { params }) => {
  const { askId } = parseParams(ParamSchemas.askId, await params, "agent.ask.retry");
  await agentGuard(req, `retry ${askId}`);
  const { viewer, ask } = await assertAskAccess(askId);
  if (ask.source === "seed") fail("FORBIDDEN", "Seeded history is read only.", 403);
  const r = await transitionAsk({
    askId,
    to: "understanding",
    expectFrom: "draft",
    actor: "user",
    actorId: viewer.actorId,
    reason: "submitted again by the ASI:One agent after a failed step",
    set: { lastErrorCode: null, lastErrorReqId: null, progress: "queued", progressAt: wallNow() },
  });
  return ok({ result: r });
});
