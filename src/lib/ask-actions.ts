import "server-only";
// Server action bodies for asks. src/app/ask/actions.ts re-exports them ("use server" files may
// only export async functions).

import { wallNow } from "@/lib/clock";
import { and, eq } from "drizzle-orm";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import { confirmAsk } from "./ask-confirm";
import { markAnswered, markCopied, markSent, saveDraftEdit, tryNextPerson } from "./ask-outcome";
import type { RankedBreakdown } from "./ask-rank-step";
import { assertAskAccess, createAndSubmitAsk, type NewAskInput } from "./asks";
import { transitionAsk } from "./ask-transition";
import { AppError } from "./errors";
import { createLogger } from "./log";
import { enforceRateLimit } from "./rate-limit";
import { withAction } from "./request-context";
import { getViewer, type Viewer } from "./viewer";

const log = createLogger("ask.action");

export const createAskAction = withAction("ask.create", async (input: NewAskInput) => {
  await enforceRateLimit("ask");
  const viewer = await getViewer();
  const owner = viewer.user?.id ?? viewer.visitorId;
  if (owner) await enforceRateLimit("ask_owner", owner);
  else log.skip("ask_owner rate limit", "first ask from a signed-out visitor without the cookie yet; the per-IP limit applies");
  return createAndSubmitAsk(input);
});

async function ownAsk(askId: string, what: string) {
  const { viewer, ask } = await assertAskAccess(askId);
  if (ask.source === "seed") {
    log.warn(`auth decision: deny ${what} on ${askId} for ${viewer.actorId} (seeded history is read only)`, { askId });
    throw new AppError("FORBIDDEN", "Seeded history is read only.", { status: 403 });
  }
  return viewer;
}

export const abandonAskAction = withAction("ask.abandon", async (input: { askId: string }) => {
  const viewer = await ownAsk(input.askId, "abandon");
  return transitionAsk({ askId: input.askId, to: "abandoned", actor: "user", actorId: viewer.actorId, reason: "abandoned by the asker from the ask page" });
});

/** From draft (after a failed step) back into processing. The page then runs the pipeline. */
export const retryAskAction = withAction("ask.retry", async (input: { askId: string }) => {
  const viewer = await ownAsk(input.askId, "retry");
  return transitionAsk({
    askId: input.askId,
    to: "understanding",
    expectFrom: "draft",
    actor: "user",
    actorId: viewer.actorId,
    reason: "submitted again from the ask page",
    set: { lastErrorCode: null, lastErrorReqId: null, progress: "queued", progressAt: wallNow() },
  });
});

/** confirming -> retrieving (find a person) or answered (a document covered it). See src/lib/ask-confirm.ts. */
export const confirmAskAction = withAction("ask.confirm", async (input: unknown) => {
  const askId = typeof input === "object" && input && "askId" in input ? String((input as { askId: unknown }).askId) : "";
  const viewer = await ownAsk(askId, "confirm");
  return confirmAsk(input, viewer);
});

/**
 * shortlist -> drafting: the asker picked a person. The pick is the human's choice, so anyone on the
 * ranked list who is not excluded by a hard guardrail may be chosen, whatever the tune position.
 * Drafting is prompt 7; until then the ask parks there with a labelled placeholder.
 */
export const chooseCandidateAction = withAction("ask.choose", async (input: { askId: string; employeeId: string; tune?: number; shownRank?: number }) => {
  const viewer = await ownAsk(String(input?.askId ?? ""), "choose");
  return chooseCandidate(input, viewer);
});

/** The body of chooseCandidateAction, for a viewer already checked (the demo reset uses it too). */
export async function chooseCandidate(input: { askId: string; employeeId: string; tune?: number; shownRank?: number }, viewer: Viewer) {
  const askId = String(input?.askId ?? "");
  const employeeId = String(input?.employeeId ?? "");
  const [row] = await q("ask.choose.candidate", (db) =>
    db
      .select({ rank: t.askCandidates.rank, breakdown: t.askCandidates.breakdown })
      .from(t.askCandidates)
      .where(and(eq(t.askCandidates.askId, askId), eq(t.askCandidates.employeeId, employeeId)))
      .limit(1),
  );
  const b = row?.breakdown as Partial<RankedBreakdown> | undefined;
  if (!row || b?.stage !== "ranked") {
    log.warn(`${askId} choose ${employeeId} refused: not a ranked candidate of this ask`, { askId });
    throw new AppError("BAD_REQUEST", "That person is not on this ask's ranked list.", { status: 400 });
  }
  if (b.features?.excluded) {
    log.warn(`${askId} choose ${employeeId} refused: guardrail ${b.features.excluded.rule} (${b.features.excluded.reason})`, { askId });
    throw new AppError("RANK_EXCLUDED", `${b.features.name} is ${b.features.excluded.reason}.`, { status: 400 });
  }
  const tune = typeof input.tune === "number" ? input.tune : 0;
  log.branch(`${askId} chose ${employeeId}`, `shown at #${input.shownRank ?? "?"} with tune ${tune}; server rank ${row.rank ?? "not shortlisted"} at tune 0`, { askId });
  // One transaction: the state check and the pick land together or not at all.
  return getDb().transaction(async (tx) => {
    const moved = await transitionAsk(
      {
        askId,
        to: "drafting",
        expectFrom: "shortlist",
        actor: "user",
        actorId: viewer.actorId,
        reason: `chose ${employeeId} (${b.features?.name ?? "?"}), shown #${input.shownRank ?? "?"} at tune ${tune}, server rank ${row.rank ?? "none"}`,
        data: { employeeId, tune, shownRank: input.shownRank ?? null, serverRank: row.rank },
        set: { progress: "queued", progressAt: wallNow() },
      },
      tx,
    );
    await qIn(tx, "ask.choose.clear", (h) => h.update(t.askCandidates).set({ chosen: false }).where(eq(t.askCandidates.askId, askId)));
    await qIn(tx, "ask.choose.set", (h) => h.update(t.askCandidates).set({ chosen: true }).where(and(eq(t.askCandidates.askId, askId), eq(t.askCandidates.employeeId, employeeId))));
    return moved;
  });
}

/** Autosave of the draft editor (ready only). */
export const saveDraftAction = withAction("ask.draft.save", async (input: unknown) => {
  const viewer = await ownAsk(askIdOf(input), "edit draft");
  return saveDraftEdit(input, viewer);
});

export const copyDraftAction = withAction("ask.draft.copy", async (input: unknown) => {
  const viewer = await ownAsk(askIdOf(input), "copy draft");
  return markCopied(input, viewer);
});

/** ready -> sent. The asker sent it themselves; this records it and moves the recipient's load. */
export const markSentAction = withAction("ask.sent", async (input: unknown) => {
  const viewer = await ownAsk(askIdOf(input), "mark sent");
  return markSent(input, viewer);
});

export const markAnsweredAction = withAction("ask.answered", async (input: unknown) => {
  const viewer = await ownAsk(askIdOf(input), "mark answered");
  return markAnswered(input, viewer);
});

export const tryNextAction = withAction("ask.next", async (input: unknown) => {
  const viewer = await ownAsk(askIdOf(input), "try next person");
  return tryNextPerson(input, viewer);
});

/** ready -> shortlist: pick someone else before sending. */
export const backToShortlistAction = withAction("ask.reshortlist", async (input: { askId: string }) => {
  const viewer = await ownAsk(input.askId, "back to shortlist");
  return transitionAsk({ askId: input.askId, to: "shortlist", expectFrom: "ready", actor: "user", actorId: viewer.actorId, reason: "went back to the shortlist from the draft, nothing sent" });
});

function askIdOf(input: unknown): string {
  return typeof input === "object" && input && "askId" in input ? String((input as { askId: unknown }).askId) : "";
}
