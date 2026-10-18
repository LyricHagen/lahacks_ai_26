import { agentAskView, agentGuard } from "@/lib/agent-api";
import { ParamSchemas } from "@/lib/inputs";
import { ok, parseParams, withRoute } from "@/lib/request-context";

/** Everything about one ask in one object: understanding, docs, shortlist with reasons, draft. */
export const GET = withRoute<{ askId: string }>("agent.ask.view", async (req, { params }) => {
  const { askId } = parseParams(ParamSchemas.askId, await params, "agent.ask.view");
  await agentGuard(req, `view ${askId}`);
  return ok({ ask: await agentAskView(askId, process.env.PUBLIC_APP_URL || req.nextUrl.origin) });
});
