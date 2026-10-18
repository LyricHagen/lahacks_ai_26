import { ASK_STATE_DEFS } from "@/lib/ask-state";
import { stepBuilt } from "@/lib/ask-pipeline";
import { asRetrieval } from "@/lib/ask-review";
import { getAskStatus } from "@/lib/asks";
import { ParamSchemas } from "@/lib/inputs";
import { ok, parseParams, withRoute } from "@/lib/request-context";

/** Polled by /ask/[askId] while the ask is processing: state, the live status line, and per-path retrieval counts. */
export const GET = withRoute<{ askId: string }>("ask.status", async (_req, { params }) => {
  const { askId } = parseParams(ParamSchemas.askId, await params, "ask.status");
  const s = await getAskStatus(askId);
  return ok({
    askId,
    state: s.status,
    phase: ASK_STATE_DEFS[s.status].phase,
    stepBuilt: stepBuilt(s.status),
    progress: s.progress,
    progressAt: s.progressAt?.toISOString() ?? null,
    running: s.running,
    retrieval: asRetrieval(s.retrieval),
    lastErrorCode: s.lastErrorCode,
    lastErrorReqId: s.lastErrorReqId,
  });
});
