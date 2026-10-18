// pnpm ask:check
// Checks the ask lifecycle (src/lib/ask-state.ts): the database enum matches ASK_STATES, every
// state is reachable from draft, every open state can still reach an end, and terminal states
// have no way out. Then, against the database, tries an illegal move and a stale compare-and-set
// on a seeded ask and expects ASK_ILLEGAL_TRANSITION and ASK_STATE_CONFLICT (nothing is written).

import "./lib/env";
import { eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { ASK_STATE_DEFS, ASK_STATES, ASK_TRANSITIONS, type AskState, mainPath, outcomeStates } from "@/lib/ask-state";
import { transitionAsk } from "@/lib/ask-transition";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { runScript } from "./lib/run";

const log = createLogger("ask.check");

function reachable(from: AskState): Set<AskState> {
  const seen = new Set<AskState>([from]);
  const todo = [from];
  while (todo.length) for (const n of ASK_TRANSITIONS[todo.pop()!]) if (!seen.has(n)) (seen.add(n), todo.push(n));
  return seen;
}

await runScript("ask-check", async () => {
  const problems: string[] = [];
  const dbEnum = t.askStateEnum.enumValues as readonly string[];
  if (dbEnum.join(",") !== ASK_STATES.join(",")) problems.push(`schema enum ask_state (${dbEnum.join(",")}) differs from ASK_STATES (${ASK_STATES.join(",")})`);
  const fromDraft = reachable("draft");
  for (const s of ASK_STATES) {
    if (!fromDraft.has(s)) problems.push(`${s} is not reachable from draft`);
    const def = ASK_STATE_DEFS[s];
    if (def.terminal && ASK_TRANSITIONS[s].length) problems.push(`${s} is terminal but has transitions`);
    if (!def.terminal && ![...reachable(s)].some((x) => ASK_STATE_DEFS[x].terminal)) problems.push(`${s} can never reach a terminal state`);
  }
  log.info(`main path: ${mainPath().join(" -> ")} -> ${outcomeStates().join(" | ")}`);
  for (const s of ASK_STATES) log.debug(`${s} (${ASK_STATE_DEFS[s].phase}, prompt ${ASK_STATE_DEFS[s].builtInPrompt}) -> ${ASK_TRANSITIONS[s].join(", ") || "terminal"}`);

  const [seeded] = await q("ask.check.pick", (db) => db.select({ id: t.asks.id, status: t.asks.status }).from(t.asks).where(eq(t.asks.status, "answered")).limit(1));
  if (!seeded) {
    log.skip("database checks", "no answered ask in the database (run pnpm seed)");
  } else {
    const expectCode = async (label: string, code: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        problems.push(`${label}: expected ${code}, but the transition succeeded`);
      } catch (err) {
        if (err instanceof AppError && err.code === code) log.info(`${label}: refused with ${code} as expected`);
        else problems.push(`${label}: expected ${code}, got ${(err as Error).message}`);
      }
    };
    await expectCode(`${seeded.id} answered -> sent`, "ASK_ILLEGAL_TRANSITION", () => transitionAsk({ askId: seeded.id, to: "sent", actor: "system", reason: "ask:check illegal move" }));
    await expectCode(`${seeded.id} stale compare-and-set`, "ASK_STATE_CONFLICT", () =>
      transitionAsk({ askId: seeded.id, to: "abandoned", expectFrom: "sent", actor: "system", reason: "ask:check stale expectFrom" }),
    );
    await expectCode("missing ask", "ASK_NOT_FOUND", () => transitionAsk({ askId: "ask_0", to: "understanding", actor: "system", reason: "ask:check missing" }));
  }

  if (problems.length) {
    for (const p of problems) log.error(`PROBLEM ${p}`);
    throw new Error(`${problems.length} problems in the ask lifecycle`);
  }
  log.info(`ask lifecycle ok: ${ASK_STATES.length} states, ${Object.values(ASK_TRANSITIONS).flat().length} transitions`);
});
