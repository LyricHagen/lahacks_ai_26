import { markSent } from "@/lib/ask-outcome";
import { getDraftView } from "@/lib/ask-review";
import { agentGuard } from "@/lib/agent-api";
import { assertAskAccess } from "@/lib/asks";
import { AgentBodies, ParamSchemas } from "@/lib/inputs";
import { fail, ok, parseParams, withRoute } from "@/lib/request-context";
import { q } from "@/db";
import * as t from "@/db/schema";
import { eq } from "drizzle-orm";
import { agentBody } from "../../../_body";

/** "I sent this" from the chat: the person sent the variant themselves. Same markSent as the button. */
export const POST = withRoute<{ askId: string }>("agent.ask.sent", async (req, { params }) => {
  const { askId } = parseParams(ParamSchemas.askId, await params, "agent.ask.sent");
  await agentGuard(req, `sent ${askId}`);
  const body = await agentBody(req, AgentBodies.sent, "agent.ask.sent");
  const { viewer, ask } = await assertAskAccess(askId);
  if (ask.source === "seed") fail("FORBIDDEN", "Seeded history is read only.", 403);
  const [row] = await q("agent.sent.load", (db) => db.select({ draft: t.asks.draft }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
  const view = await getDraftView(askId, row?.draft);
  if (!view) fail("DRAFT_INVALID", "This ask has no draft to send.", 409);
  const m = view.messages[body.variant];
  const r = await markSent({ askId, variant: body.variant, format: m.format, subject: m.subject, body: m.body }, viewer);
  return ok({ result: r });
});
