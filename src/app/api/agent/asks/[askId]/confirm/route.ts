import { confirmAsk } from "@/lib/ask-confirm";
import { agentGuard } from "@/lib/agent-api";
import { assertAskAccess } from "@/lib/asks";
import { AgentBodies, ParamSchemas } from "@/lib/inputs";
import { createLogger } from "@/lib/log";
import { fail, ok, parseParams, withRoute } from "@/lib/request-context";
import { normalizeUnderstanding } from "@/lib/understanding";
import { q } from "@/db";
import * as t from "@/db/schema";
import { eq } from "drizzle-orm";
import { agentBody } from "../../../_body";

const log = createLogger("agent.api");

/**
 * Confirm the understanding as read (the chat has no chip editor) and either find a person, or
 * close the ask with an offered document that answered it. Same confirmAsk as the confirm panel.
 */
export const POST = withRoute<{ askId: string }>("agent.ask.confirm", async (req, { params }) => {
  const { askId } = parseParams(ParamSchemas.askId, await params, "agent.ask.confirm");
  await agentGuard(req, `confirm ${askId}`);
  const body = await agentBody(req, AgentBodies.confirm, "agent.ask.confirm");
  const { viewer, ask } = await assertAskAccess(askId);
  if (ask.source === "seed") fail("FORBIDDEN", "Seeded history is read only.", 403);
  const [row] = await q("agent.confirm.load", (db) => db.select({ understanding: t.asks.understanding }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
  const u = normalizeUnderstanding(row?.understanding);
  if (!u) fail("ASK_CONFIRM_INVALID", "This ask has nothing to confirm yet.", 409);
  log.branch(`${askId} agent confirm as read`, body.answeredByDocId ? `the chat said ${body.answeredByDocId} answered it` : "the chat asked to find a person", { askId });
  const r = await confirmAsk(
    { askId, restatement: u.restatement, serviceIds: u.services.map((s) => s.id), skillIds: u.skills.map((s) => s.id), artifacts: u.artifacts, helpKind: u.helpKind, urgency: u.urgency, sensitive: u.sensitive, answeredByDocId: body.answeredByDocId ?? null },
    viewer,
  );
  return ok({ result: r });
});
