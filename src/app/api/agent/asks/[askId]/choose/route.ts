import { chooseCandidate } from "@/lib/ask-actions";
import { agentGuard } from "@/lib/agent-api";
import { assertAskAccess } from "@/lib/asks";
import { AgentBodies, ParamSchemas } from "@/lib/inputs";
import { fail, ok, parseParams, withRoute } from "@/lib/request-context";
import { agentBody } from "../../../_body";

/** Pick a person from the shortlist (shortlist -> drafting), same chooseCandidate as "Ask <name>". Then POST .../run for the draft. */
export const POST = withRoute<{ askId: string }>("agent.ask.choose", async (req, { params }) => {
  const { askId } = parseParams(ParamSchemas.askId, await params, "agent.ask.choose");
  await agentGuard(req, `choose on ${askId}`);
  const body = await agentBody(req, AgentBodies.choose, "agent.ask.choose");
  const { viewer, ask } = await assertAskAccess(askId);
  if (ask.source === "seed") fail("FORBIDDEN", "Seeded history is read only.", 403);
  const r = await chooseCandidate({ askId, employeeId: body.employeeId }, viewer);
  return ok({ result: r });
});
