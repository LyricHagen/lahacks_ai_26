import "server-only";
// The only code that changes asks.status. Each call checks the move against ASK_TRANSITIONS
// (src/lib/ask-state.ts), updates the ask and writes one ask_events row in the same transaction,
// and logs one line with the ask id, both states, the actor and the reason.

import { wallNow } from "@/lib/clock";
import { eq, sql } from "drizzle-orm";
import { getDb, qIn, type Tx } from "@/db";
import * as t from "@/db/schema";
import { type AskActor, type AskState, ASK_INITIAL_STATES, ASK_TRANSITIONS, canTransition } from "./ask-state";
import { AppError } from "./errors";
import { createLogger, currentReqId } from "./log";

const log = createLogger("ask.state");

export type TransitionInput = {
  askId: string;
  to: AskState;
  /** If given, the move only happens when the ask is still in this state (compare and set). */
  expectFrom?: AskState;
  actor: AskActor;
  /** usr_N, "visitor", or null for the system. */
  actorId?: string | null;
  reason: string;
  data?: Record<string, unknown>;
  /** Extra columns to set on the ask in the same update (progress, errors, ...). */
  set?: Partial<typeof t.asks.$inferInsert>;
};

export type TransitionResult = { askId: string; from: AskState; to: AskState; at: Date };

export async function transitionAsk(input: TransitionInput, tx?: Tx): Promise<TransitionResult> {
  if (tx) return transitionIn(tx, input);
  return getDb().transaction((inner) => transitionIn(inner, input));
}

async function transitionIn(tx: Tx, input: TransitionInput): Promise<TransitionResult> {
  const { askId, to, actor, reason } = input;
  const rows = await qIn(tx, "ask.transition.lock", (h) => h.select({ status: t.asks.status }).from(t.asks).where(eq(t.asks.id, askId)).for("update"));
  const row = rows[0];
  if (!row) {
    log.error(`${askId} transition to ${to} refused: ask does not exist`, { askId, attempted: to, actor, reason });
    throw new AppError("ASK_NOT_FOUND", undefined, { status: 404, context: { askId } });
  }
  const from = row.status;
  if (input.expectFrom && input.expectFrom !== from) {
    log.warn(`${askId} transition ${input.expectFrom} -> ${to} refused: ask is now in ${from} (changed by another request)`, {
      askId,
      current: from,
      expected: input.expectFrom,
      attempted: to,
      actor,
    });
    throw new AppError("ASK_STATE_CONFLICT", undefined, { status: 409, context: { askId, current: from, expected: input.expectFrom, attempted: to } });
  }
  if (!canTransition(from, to)) {
    log.error(`${askId} ILLEGAL transition ${from} -> ${to} actor=${actor} reason="${reason}" (allowed from ${from}: ${ASK_TRANSITIONS[from].join(", ") || "none, terminal"})`, {
      askId,
      current: from,
      attempted: to,
      actor,
    });
    throw new AppError("ASK_ILLEGAL_TRANSITION", `An ask in state "${from}" cannot move to "${to}".`, { status: 409, context: { askId, current: from, attempted: to } });
  }
  const at = wallNow();
  await qIn(tx, "ask.transition.update", (h) =>
    h
      .update(t.asks)
      .set({
        ...input.set,
        status: to,
        updatedAt: at,
        ...(to === "answered" ? { resolvedAt: at } : {}),
      })
      .where(eq(t.asks.id, askId)),
  );
  await qIn(tx, "ask.transition.event", (h) =>
    h.insert(t.askEvents).values({ askId, kind: "transition", fromState: from, toState: to, actor, actorId: input.actorId ?? null, reason, reqId: currentReqId(), data: input.data ?? null, at }),
  );
  log.info(`${askId} transition ${from} -> ${to} actor=${actor}${input.actorId ? `(${input.actorId})` : ""} reason="${reason}"`, { askId, from, to, actor, ...(input.data ? { data: input.data } : {}) });
  return { askId, from, to, at };
}

/** Write the creation row (from null to the initial state). Called inside the insert transaction. */
export async function recordCreated(tx: Tx, askId: string, state: AskState, actor: AskActor, actorId: string | null, reason: string): Promise<void> {
  if (!ASK_INITIAL_STATES.includes(state)) {
    log.error(`${askId} ILLEGAL initial state ${state} (allowed: ${ASK_INITIAL_STATES.join(", ")})`, { askId, attempted: state });
    throw new AppError("ASK_ILLEGAL_TRANSITION", `An ask cannot start in state "${state}".`, { status: 409 });
  }
  await qIn(tx, "ask.transition.created", (h) => h.insert(t.askEvents).values({ askId, kind: "transition", fromState: null, toState: state, actor, actorId, reason, reqId: currentReqId() }));
  log.info(`${askId} transition (new) -> ${state} actor=${actor}${actorId ? `(${actorId})` : ""} reason="${reason}"`, { askId, from: null, to: state, actor });
}

/**
 * Set the live status line shown under the skeleton while the ask is processing. Not a state
 * change, so no ask_events row; logged so a stuck ask shows how far it got.
 */
export async function setProgress(tx: Tx | null, askId: string, line: string): Promise<void> {
  const run = (h: Tx | ReturnType<typeof getDb>) => h.update(t.asks).set({ progress: line, progressAt: sql`now()` }).where(eq(t.asks.id, askId));
  if (tx) await qIn(tx, "ask.progress", run);
  else await qIn(getDb(), "ask.progress", run);
  log.info(`${askId} progress: ${line}`, { askId });
}
