import { agentGuard } from "@/lib/agent-api";
import { createAndSubmitAsk } from "@/lib/asks";
import { AgentBodies } from "@/lib/inputs";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ok, withRoute } from "@/lib/request-context";
import { agentBody } from "../_body";

/** Create and submit an ask for the agent's sender (same function as the composer). Then POST /api/asks/[askId]/run. */
export const POST = withRoute("agent.ask.create", async (req) => {
  const { sender } = await agentGuard(req, "create ask");
  const input = await agentBody(req, AgentBodies.create, "agent.ask.create");
  await enforceRateLimit("ask");
  await enforceRateLimit("ask_owner", sender);
  const r = await createAndSubmitAsk({ body: input.body, tried: input.tried, urgency: input.urgency });
  return ok({ ...r, run: `/api/asks/${r.askId}/run`, status: `/api/asks/${r.askId}` }, 201);
});
