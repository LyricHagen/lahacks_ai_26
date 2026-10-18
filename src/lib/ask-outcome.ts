import "server-only";
// After the draft: the asker edits it, copies it, sends it themselves, and tells Altostratus what
// happened. This is what closes the loop for load balancing: "I sent this" writes the `sent`
// transition with the recipient on it, and loadsThisWeek (src/lib/availability.ts) counts exactly
// those rows, so the next ranking sees the recipient one ask busier.
//
//   ready -> sent              "I sent this" (recipient's load this week goes up by one)
//   sent | stale -> answered   "They answered", with an optional one line answer (feeds /insights)
//   sent -> stale -> drafting  "Ask <next> instead": no answer yet, try the next person on the shortlist
//
// Log lines (grep the ask id): "draft edit", "copied", "sent to", "load emp_113 before", "answered by".

import { and, eq, inArray } from "drizzle-orm";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import { asDraftSummary, type DraftSummary } from "./ask-draft-step";
import type { RankedBreakdown } from "./ask-rank-step";
import { type AskState, type AskUrgency } from "./ask-state";
import { transitionAsk } from "./ask-transition";
import { loadThisWeek, slotLabel } from "./availability";
import { wallMs, wallNow } from "./clock";
import { getClock } from "./clock-request";
import { ANSWER_NOTE_MAX, BODY_MAX, type DraftFormat, type DraftVariant, isDraftFormat, isDraftVariant, SUBJECT_MAX, VARIANT_DEF, wordCount } from "./draft";
import { AppError } from "./errors";
import { createLogger } from "./log";
import { RANK_CONFIG } from "./rank";
import { addDays, localDate, localTime, localToUtc, weekday } from "./time";
import { protectUnderstanding } from "./understand-build";
import { normalizeUnderstanding } from "./understanding";
import type { Viewer } from "./viewer";

const log = createLogger("ask.outcome");

type DraftFields = { askId: string; variant: DraftVariant; format: DraftFormat; subject: string; body: string };

function parseFields(input: unknown): DraftFields {
  const i = (input ?? {}) as Record<string, unknown>;
  const askId = String(i.askId ?? "");
  const subject = typeof i.subject === "string" ? i.subject : "";
  const body = typeof i.body === "string" ? i.body : "";
  if (!/^ask_\d+$/.test(askId) || !isDraftVariant(i.variant) || !isDraftFormat(i.format) || subject.length > SUBJECT_MAX || body.length > BODY_MAX) {
    log.warn(`draft input refused: ${!isDraftVariant(i.variant) ? "unknown variant" : !isDraftFormat(i.format) ? "unknown format" : subject.length > SUBJECT_MAX ? `subject ${subject.length} chars` : body.length > BODY_MAX ? `body ${body.length} chars` : "bad ask id"}`);
    throw new AppError("DRAFT_INVALID", undefined, { status: 400 });
  }
  return { askId, variant: i.variant, format: i.format, subject, body };
}

/** Every sensitive span of the ask is scrubbed from the log lines of this request. */
async function loadForDraft(askId: string) {
  const [ask] = await q("ask.outcome.load", (db) =>
    db
      .select({ status: t.asks.status, draft: t.asks.draft, understanding: t.asks.understanding, urgency: t.asks.urgency, routedToId: t.asks.routedToId, askerId: t.asks.askerEmployeeId })
      .from(t.asks)
      .where(eq(t.asks.id, askId))
      .limit(1),
  );
  if (!ask) throw new AppError("ASK_NOT_FOUND", undefined, { status: 404 });
  protectUnderstanding(normalizeUnderstanding(ask.understanding));
  return { ...ask, summary: asDraftSummary(ask.draft) };
}

function requireState(askId: string, what: string, current: AskState, allowed: AskState[]) {
  if (!allowed.includes(current)) {
    log.warn(`${askId} ${what} refused: ask is in ${current}, not ${allowed.join(" or ")}`, { askId });
    throw new AppError("ASK_STATE_CONFLICT", undefined, { status: 409, context: { askId, current } });
  }
}

/** Autosave of an edit in place. The action's enter line carries the text; this line adds the counts. */
export async function saveDraftEdit(input: unknown, viewer: Viewer): Promise<{ words: number }> {
  const f = parseFields(input);
  const ask = await loadForDraft(f.askId);
  requireState(f.askId, "draft edit", ask.status, ["ready"]);
  const [row] = await q("ask.outcome.edit", (db) =>
    db
      .update(t.askMessages)
      .set({ subject: f.subject, body: f.body, channel: f.format, updatedAt: wallNow() })
      .where(and(eq(t.askMessages.askId, f.askId), eq(t.askMessages.variant, f.variant)))
      .returning({ originalBody: t.askMessages.originalBody }),
  );
  if (!row) throw new AppError("DRAFT_INVALID", "This ask has no draft for that variant.", { status: 404 });
  const words = wordCount(f.body);
  log.info(`${f.askId} draft edit ${f.variant} as ${f.format} by ${viewer.actorId}: ${words} words, ${f.body.length} chars${row.originalBody === f.body ? ", same as drafted" : ", edited"}`, { askId: f.askId });
  return { words };
}

/** The Copy button: a note on the ask (not a state change), so the log shows what was copied. */
export async function markCopied(input: unknown, viewer: Viewer): Promise<{ ok: true }> {
  const f = parseFields(input);
  const ask = await loadForDraft(f.askId);
  requireState(f.askId, "copy", ask.status, ["ready", "sent", "stale", "answered"]);
  const words = wordCount(f.body);
  await getDb().transaction(async (tx) => {
    await qIn(tx, "ask.outcome.copied", (h) =>
      h
        .update(t.askMessages)
        .set({ status: "copied", updatedAt: wallNow() })
        .where(and(eq(t.askMessages.askId, f.askId), eq(t.askMessages.variant, f.variant), eq(t.askMessages.status, "draft"))),
    );
    await qIn(tx, "ask.outcome.copied.event", (h) =>
      h.insert(t.askEvents).values({ askId: f.askId, kind: "copied", actor: "user", actorId: viewer.actorId, reason: `copied ${VARIANT_DEF[f.variant].label} as ${f.format} (${words} words)`, data: { variant: f.variant, format: f.format, words }, at: wallNow() }),
    );
  });
  log.info(`${f.askId} copied ${f.variant} as ${f.format} by ${viewer.actorId}: ${words} words, ${f.body.length} chars to the clipboard`, { askId: f.askId });
  return { ok: true };
}

export type SentResult = { askId: string; recipientId: string; recipientName: string; loadBefore: number; loadAfter: number; max: number };

/**
 * "I sent this": the asker sent the message themselves. Saves exactly what they had on screen,
 * moves ready -> sent with the recipient on the event, and recounts the recipient's load.
 */
export async function markSent(input: unknown, viewer: Viewer): Promise<SentResult> {
  const f = parseFields(input);
  if (!f.body.trim()) throw new AppError("DRAFT_INVALID", "The message is empty.", { status: 400 });
  const ask = await loadForDraft(f.askId);
  requireState(f.askId, "mark sent", ask.status, ["ready"]);
  const s = ask.summary;
  if (!s) throw new AppError("DRAFT_INVALID", "This ask has no draft to send.", { status: 409 });
  const recId = s.recipient.id;
  const [rec] = await q("ask.outcome.recipient", (db) => db.select({ max: t.employees.maxWeeklyAsks }).from(t.employees).where(eq(t.employees.id, recId)).limit(1));
  const max = rec?.max ?? 0;
  const clock = await getClock();
  const loadBefore = await loadThisWeek(recId, clock.now);
  log.info(`${f.askId} load ${recId} before send: ${loadBefore} of ${max} asks this week (app time ${clock.now.toISOString()}${clock.pinned ? ", pinned" : ""})`, { askId: f.askId });
  const words = wordCount(f.body);
  const edited = await q("ask.outcome.original", (db) =>
    db.select({ originalBody: t.askMessages.originalBody, originalSubject: t.askMessages.originalSubject }).from(t.askMessages).where(and(eq(t.askMessages.askId, f.askId), eq(t.askMessages.variant, f.variant))).limit(1),
  );
  const wasEdited = !!edited[0] && (edited[0].originalBody !== f.body || (edited[0].originalSubject ?? "") !== f.subject);

  const at = wallNow();
  const sent: NonNullable<DraftSummary["sent"]> = { variant: f.variant, format: f.format, words, edited: wasEdited, at: at.toISOString(), appAt: clock.now.toISOString(), loadBefore, loadAfter: loadBefore + 1, max };
  await getDb().transaction(async (tx) => {
    await qIn(tx, "ask.outcome.sent.message", (h) =>
      h
        .update(t.askMessages)
        .set({ subject: f.subject, body: f.body, channel: f.format, status: "marked_sent", updatedAt: at })
        .where(and(eq(t.askMessages.askId, f.askId), eq(t.askMessages.variant, f.variant))),
    );
    await transitionAsk(
      {
        askId: f.askId,
        to: "sent",
        expectFrom: "ready",
        actor: "user",
        actorId: viewer.actorId,
        reason: `sent to ${recId} (${s.recipient.name}) by the asker: ${VARIANT_DEF[f.variant].label} as ${f.format}, ${words} words${wasEdited ? ", edited" : ""}`,
        // loadsThisWeek reads recipientId from this row: this is what moves their load.
        data: { recipientId: recId, variant: f.variant, format: f.format, words, edited: wasEdited, loadBefore },
        set: { routedToId: recId, sentAt: at, sentAppAt: clock.now, draft: { ...s, sent } },
      },
      tx,
    );
  });
  const loadAfter = await loadThisWeek(recId, clock.now);
  if (loadAfter !== loadBefore + 1) log.warn(`${f.askId} load ${recId} after send is ${loadAfter}, expected ${loadBefore + 1} (sent event outside the load window?)`, { askId: f.askId });
  if (loadAfter !== sent.loadAfter) await q("ask.outcome.sent.recount", (db) => db.update(t.asks).set({ draft: { ...s, sent: { ...sent, loadAfter } } }).where(eq(t.asks.id, f.askId)));
  log.info(
    `${f.askId} sent to ${recId} ${s.recipient.name} as ${f.variant}/${f.format} (${words} words${wasEdited ? ", edited by the asker" : ", as drafted"}); load ${recId} before ${loadBefore} after ${loadAfter} of ${max} this week${loadAfter >= max ? ": now at their weekly limit, so ranking routes the next ask around them (hard_cap)" : ""}`,
    { askId: f.askId, recipientId: recId, loadBefore, loadAfter, max },
  );
  return { askId: f.askId, recipientId: recId, recipientName: s.recipient.name, loadBefore, loadAfter, max };
}

/** "They answered": closes the ask. The one line answer is optional and feeds /insights. */
export async function markAnswered(input: unknown, viewer: Viewer): Promise<{ askId: string }> {
  const i = (input ?? {}) as Record<string, unknown>;
  const askId = String(i.askId ?? "");
  const note = typeof i.note === "string" ? i.note.replace(/\s+/g, " ").trim() : "";
  if (!/^ask_\d+$/.test(askId) || note.length > ANSWER_NOTE_MAX) {
    log.warn(`answered refused: ${note.length > ANSWER_NOTE_MAX ? `note is ${note.length} chars, max ${ANSWER_NOTE_MAX}` : "bad ask id"}`);
    throw new AppError("DRAFT_INVALID", `Keep the answer to one line (under ${ANSWER_NOTE_MAX} characters).`, { status: 400 });
  }
  const ask = await loadForDraft(askId);
  requireState(askId, "mark answered", ask.status, ["sent", "stale"]);
  const by = ask.routedToId ?? ask.summary?.recipient.id ?? null;
  await transitionAsk({
    askId,
    to: "answered",
    expectFrom: ask.status,
    actor: "user",
    actorId: viewer.actorId,
    reason: `answered by ${by ?? "the recipient"}${note ? `, answer captured (${note.length} chars)` : ", no answer captured"}`,
    data: { answeredBy: by, via: "person", hasNote: !!note },
    set: { answeredVia: "person", answeredById: by, answerNote: note || null },
  });
  log.info(`${askId} answered by ${by ?? "unknown"} (via person)${note ? `: "${note}"` : "; the asker skipped the one line answer"}`, { askId });
  return { askId };
}

/** "Ask <next> instead": no answer yet. sent -> stale (recorded) -> drafting for the new person. */
export async function tryNextPerson(input: unknown, viewer: Viewer): Promise<{ askId: string }> {
  const i = (input ?? {}) as Record<string, unknown>;
  const askId = String(i.askId ?? "");
  const employeeId = String(i.employeeId ?? "");
  const ask = await loadForDraft(askId);
  requireState(askId, "try next person", ask.status, ["sent", "stale"]);
  const [row] = await q("ask.outcome.next", (db) =>
    db
      .select({ rank: t.askCandidates.rank, breakdown: t.askCandidates.breakdown })
      .from(t.askCandidates)
      .where(and(eq(t.askCandidates.askId, askId), eq(t.askCandidates.employeeId, employeeId)))
      .limit(1),
  );
  const b = row?.breakdown as Partial<RankedBreakdown> | undefined;
  if (!row || b?.stage !== "ranked" || b.features?.excluded || employeeId === ask.routedToId) {
    log.warn(`${askId} try next ${employeeId} refused: ${!row || b?.stage !== "ranked" ? "not a ranked candidate" : b.features?.excluded ? `excluded (${b.features.excluded.rule})` : "already the recipient"}`, { askId });
    throw new AppError("BAD_REQUEST", "That person cannot be asked next.", { status: 400 });
  }
  const f = await followUpFor(askId);
  if (f?.sentTo.includes(employeeId)) {
    log.warn(`${askId} try next ${employeeId} refused: this ask was already sent to them`, { askId });
    throw new AppError("BAD_REQUEST", "This ask was already sent to that person.", { status: 400 });
  }
  await getDb().transaction(async (tx) => {
    if (ask.status === "sent") {
      await transitionAsk(
        {
          askId,
          to: "stale",
          expectFrom: "sent",
          actor: "user",
          actorId: viewer.actorId,
          reason: f?.overdue ? `no answer from ${ask.routedToId} within ${f.horizon}` : `asker moved on before the horizon (${f?.horizon ?? "unknown"}) passed`,
          data: { from: ask.routedToId, overdue: !!f?.overdue },
        },
        tx,
      );
    }
    await transitionAsk(
      {
        askId,
        to: "drafting",
        expectFrom: "stale",
        actor: "user",
        actorId: viewer.actorId,
        reason: `trying the next person: ${employeeId} (${b.features?.name ?? "?"}), shortlist rank ${row.rank ?? "none"}`,
        data: { employeeId, previous: ask.routedToId, serverRank: row.rank },
        set: { progress: "queued", progressAt: wallNow() },
      },
      tx,
    );
    await qIn(tx, "ask.outcome.next.clear", (h) => h.update(t.askCandidates).set({ chosen: false }).where(eq(t.askCandidates.askId, askId)));
    await qIn(tx, "ask.outcome.next.set", (h) => h.update(t.askCandidates).set({ chosen: true }).where(and(eq(t.askCandidates.askId, askId), eq(t.askCandidates.employeeId, employeeId))));
  });
  log.info(`${askId} next person ${employeeId} after ${ask.routedToId}: ${f?.overdue ? "overdue" : "before the horizon"}; the first send still counts toward ${ask.routedToId}'s load`, { askId });
  return { askId };
}

// ---------------------------------------------------------------------------
// the follow-up card
// ---------------------------------------------------------------------------

/** n working days after an instant, at the same local time, in a zone. */
export function addWorkingDays(at: Date, n: number, tz: string): Date {
  const [h, m] = localTime(at, tz).split(":").map(Number);
  let day = localDate(at, tz);
  for (let left = n; left > 0; ) {
    day = addDays(day, 1);
    const wd = weekday(day);
    if (wd !== 0 && wd !== 6) left--;
  }
  return localToUtc(day, h * 60 + m, tz);
}

export type FollowUp = {
  recipientId: string;
  recipientName: string;
  sentLabel: string;
  horizon: string;
  deadlineLabel: string;
  overdue: boolean;
  waitedMinutes: number;
  /** Who to try next: the shortlist in order, minus anyone already sent this ask and anyone excluded. */
  next: { id: string; name: string; title: string; reason: string | null; load: { count: number; max: number } } | null;
  sentTo: string[];
};

/**
 * Elapsed time is real (wall) time since the asker said they sent it, laid onto the app time at
 * that moment. In demo mode the app clock is pinned, so this is the only way waiting can pass;
 * in live mode both clocks are the real time and it is plain elapsed time.
 */
export async function followUpFor(askId: string): Promise<FollowUp | null> {
  const [ask] = await q("ask.followup.load", (db) =>
    db.select({ urgency: t.asks.urgency, understanding: t.asks.understanding, sentAt: t.asks.sentAt, sentAppAt: t.asks.sentAppAt, routedToId: t.asks.routedToId, askerId: t.asks.askerEmployeeId, draft: t.asks.draft }).from(t.asks).where(eq(t.asks.id, askId)).limit(1),
  );
  if (!ask?.sentAt || !ask.sentAppAt || !ask.routedToId) {
    log.skip(`${askId} follow-up card`, "the ask has no recorded send");
    return null;
  }
  const urgency: AskUrgency = normalizeUnderstanding(ask.understanding)?.urgency ?? ask.urgency;
  const n = RANK_CONFIG.availability.horizonWorkingDays[urgency];
  const horizon = n === 1 ? "one working day" : `${n} working days`;
  const [events, cands, people] = await Promise.all([
    q("ask.followup.sent", (db) => db.select({ data: t.askEvents.data }).from(t.askEvents).where(and(eq(t.askEvents.askId, askId), eq(t.askEvents.toState, "sent")))),
    q("ask.followup.candidates", (db) => db.select({ employeeId: t.askCandidates.employeeId, rank: t.askCandidates.rank, score: t.askCandidates.score, breakdown: t.askCandidates.breakdown, explanation: t.askCandidates.explanation }).from(t.askCandidates).where(eq(t.askCandidates.askId, askId))),
    q("ask.followup.people", (db) => db.select({ id: t.employees.id, name: t.employees.name, tz: t.employees.timezone }).from(t.employees).where(inArray(t.employees.id, [ask.routedToId!, ...(ask.askerId ? [ask.askerId] : [])]))),
  ]);
  const tz = people.find((p) => p.id === ask.askerId)?.tz ?? "America/Los_Angeles";
  const sentTo = [...new Set([...events.map((e) => (e.data as { recipientId?: string } | null)?.recipientId).filter((x): x is string => !!x), ask.routedToId])];
  const deadline = addWorkingDays(ask.sentAppAt, n, tz);
  const waitedMs = Math.max(0, wallMs() - ask.sentAt.getTime());
  const effective = ask.sentAppAt.getTime() + waitedMs;
  const overdue = effective >= deadline.getTime();
  const ordered = cands
    .map((c) => ({ ...c, b: c.breakdown as Partial<RankedBreakdown> }))
    .filter((c) => c.b.stage === "ranked" && c.b.features && !c.b.features.excluded && !sentTo.includes(c.employeeId))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (b.score ?? 0) - (a.score ?? 0));
  const pick = ordered[0];
  const next = pick ? { id: pick.employeeId, name: pick.b.features!.name, title: pick.b.features!.title, reason: pick.explanation, load: pick.b.features!.load } : null;
  const recipientName = people.find((p) => p.id === ask.routedToId)?.name ?? ask.routedToId;
  log.branch(
    `${askId} follow-up ${overdue ? "OVERDUE" : "waiting"}`,
    `sent ${Math.round(waitedMs / 60000)} min ago (wall), horizon ${horizon} for ${urgency} ends ${deadline.toISOString()} app time; next ${next ? `${next.id} (shortlist rank ${pick.rank ?? "none"})` : "nobody left on the shortlist"}; already sent to ${sentTo.join(", ")}`,
    { askId },
  );
  return { recipientId: ask.routedToId, recipientName, sentLabel: slotLabel(ask.sentAppAt, tz), horizon, deadlineLabel: slotLabel(deadline, tz), overdue, waitedMinutes: Math.round(waitedMs / 60000), next, sentTo };
}
