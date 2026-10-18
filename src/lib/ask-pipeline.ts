import "server-only";
// Runs an ask through its processing states. Each processing state has at most one step in
// ASK_STEPS; a step does its work, reports progress lines, and names the next state. The runner
// moves the ask with transitionAsk and stops at the first state that is not processing, or at a
// processing state whose step is not built yet (the ask page then shows a labelled placeholder).
//
// Built: understanding and retrieving (prompt 5), ranking (prompt 6), drafting (prompt 8).
// Between them the ask waits in confirming (a review state) for the asker to check the chips.

import { wallMs, wallNow } from "@/lib/clock";
import { eq, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { type AskState, ASK_STATE_DEFS, isProcessing } from "./ask-state";
import { setProgress, transitionAsk } from "./ask-transition";
import { draftAsk } from "./ask-draft-step";
import { rankAsk } from "./ask-rank-step";
import { retrieveAsk } from "./ask-retrieve-step";
import { understandAsk } from "./ask-understand";
import { AppError, toAppError } from "./errors";
import { span } from "./observe";
import { createLogger, currentReqId } from "./log";

const log = createLogger("ask.pipeline");

/** How long a run may hold an ask before another request may take over. */
const LEASE_S = 60;

/**
 * Each status line stays up at least this long, so a fast step still reads as visible work
 * instead of a flash. 0 turns pacing off. Env: ASK_STEP_MIN_MS.
 */
function minLineMs(): number {
  const v = Number.parseInt(process.env.ASK_STEP_MIN_MS ?? "", 10);
  return Number.isFinite(v) && v >= 0 ? v : 700;
}

export type StepContext = {
  askId: string;
  /** Show a live status line under the skeleton ("searching 200 people"). */
  progress: (line: string) => Promise<void>;
};

export type StepResult = {
  to: AskState;
  reason: string;
  data?: Record<string, unknown>;
};

export type AskStep = (ctx: StepContext) => Promise<StepResult>;

export const ASK_STEPS: Partial<Record<AskState, AskStep>> = {
  understanding: understandAsk,
  retrieving: retrieveAsk,
  ranking: rankAsk,
  drafting: draftAsk,
};

export function stepBuilt(state: AskState): boolean {
  return !isProcessing(state) || !!ASK_STEPS[state];
}

async function takeLease(askId: string): Promise<boolean> {
  const rows = await q("ask.pipeline.lease", (db) =>
    db
      .update(t.asks)
      .set({ runLeaseUntil: sql`now() + make_interval(secs => ${LEASE_S})` })
      .where(sql`${t.asks.id} = ${askId} and (${t.asks.runLeaseUntil} is null or ${t.asks.runLeaseUntil} < now())`)
      .returning({ id: t.asks.id }),
  );
  return rows.length > 0;
}

async function releaseLease(askId: string): Promise<void> {
  await q("ask.pipeline.release", (db) => db.update(t.asks).set({ runLeaseUntil: null }).where(eq(t.asks.id, askId)));
}

export type RunOutcome = { askId: string; state: AskState; ran: string[]; stoppedBecause: string };

/** paceMs overrides ASK_STEP_MIN_MS (the demo reset runs at 0: nobody is watching those lines). */
export async function runAskPipeline(askId: string, opts: { paceMs?: number } = {}): Promise<RunOutcome> {
  if (!(await takeLease(askId))) {
    log.skip(`${askId} pipeline run`, "another request holds the run lease; this caller just polls");
    const [row] = await q("ask.pipeline.state", (db) => db.select({ status: t.asks.status }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
    return { askId, state: row?.status ?? "draft", ran: [], stoppedBecause: "already running" };
  }
  const ran: string[] = [];
  const pace = opts.paceMs ?? minLineMs();
  let lastLineAt = 0;
  const progress = async (line: string) => {
    const wait = lastLineAt ? pace - (wallMs() - lastLineAt) : 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await setProgress(null, askId, line);
    // Each line renews the lease, so a step with several slow provider calls (CREAO, then StepFun) outlives LEASE_S.
    await q("ask.pipeline.renew", (db) => db.update(t.asks).set({ runLeaseUntil: sql`now() + make_interval(secs => ${LEASE_S})` }).where(eq(t.asks.id, askId)));
    lastLineAt = wallMs();
  };
  log.info(`${askId} pipeline start`, { askId, paceMs: pace });
  try {
    for (let guard = 0; guard < 12; guard++) {
      const [row] = await q("ask.pipeline.state", (db) => db.select({ status: t.asks.status }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
      if (!row) throw new AppError("ASK_NOT_FOUND", undefined, { status: 404 });
      const state = row.status;
      const def = ASK_STATE_DEFS[state];
      if (!isProcessing(state)) {
        log.branch(`${askId} stop pipeline in ${state}`, `${state} is a ${def.phase} state, not processing`, { askId });
        return { askId, state, ran, stoppedBecause: `${state} is not a processing state` };
      }
      const step = ASK_STEPS[state];
      if (!step) {
        log.skip(`${askId} step ${state}`, `it is not built yet (prompt ${def.builtInPrompt}); the ask stays parked in ${state}`, { askId });
        await progress(`The ${def.label.toLowerCase()} step is not built yet (prompt ${def.builtInPrompt})`);
        return { askId, state, ran, stoppedBecause: `${state} not built (prompt ${def.builtInPrompt})` };
      }
      let result: StepResult;
      try {
        result = await span(`ask.step.${state}`, "ask.step", { ask_id: askId, state }, () => log.timed(`${askId} step ${state}`, () => step({ askId, progress }), { askId }));
      } catch (err) {
        const appErr = toAppError(err, "ASK_STEP_FAILED");
        const code = appErr.code === "UNKNOWN" ? "ASK_STEP_FAILED" : appErr.code;
        log.error(`${askId} step ${state} failed with ${code}, sending the ask back to draft`, { askId, err });
        await transitionAsk({
          askId,
          to: "draft",
          expectFrom: state,
          actor: "system",
          reason: `${state} failed: ${code}`,
          set: { lastErrorCode: code, lastErrorReqId: currentReqId(), progress: null },
        });
        return { askId, state: "draft", ran, stoppedBecause: `${state} failed with ${code}` };
      }
      ran.push(state);
      // Let the step's last line be read before the state changes under it.
      const dwell = lastLineAt ? pace - (wallMs() - lastLineAt) : 0;
      if (dwell > 0) {
        log.trace(`${askId} hold last line ${dwell}ms before leaving ${state}`, { askId, paceMs: pace });
        await new Promise((r) => setTimeout(r, dwell));
      }
      await transitionAsk({
        askId,
        to: result.to,
        expectFrom: state,
        actor: "system",
        reason: result.reason,
        data: result.data,
        set: isProcessing(result.to) ? { progress: "starting the next step", progressAt: wallNow() } : { progress: null },
      });
    }
    log.warn(`${askId} pipeline stopped after 12 steps (loop guard)`, { askId, ran });
    return { askId, state: "draft", ran, stoppedBecause: "loop guard" };
  } finally {
    await releaseLease(askId);
    log.info(`${askId} pipeline end`, { askId, ran });
  }
}
