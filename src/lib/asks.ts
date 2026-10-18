import "server-only";
// Asks: create, load with an access check, and the lists for /dashboard. State changes are never
// made here directly; they go through transitionAsk (src/lib/ask-transition.ts).

import { wallMs, wallNow } from "@/lib/clock";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import { type AskState, type AskUrgency, ASK_STATES, isOpen, URGENCIES } from "./ask-state";
import { recordCreated, transitionAsk } from "./ask-transition";
import { AppError } from "./errors";
import { createLogger, markSensitive } from "./log";
import { ensureVisitorId, getViewer, type Viewer } from "./viewer";

const log = createLogger("ask");

export const ASK_BODY_MIN = 8;
export const ASK_BODY_MAX = 4000;
export const ASK_EXTRA_MAX = 2000;

export type NewAskInput = { body: string; tried?: string; urgency?: string; confidential?: string };

function titleFrom(body: string): string {
  const first = body.trim().split(/\n/)[0].replace(/\s+/g, " ");
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}...` : first;
}

/**
 * Create an ask in draft and submit it (draft -> understanding) in one transaction. The ask page
 * then runs the pipeline. The confidential note is stored for the drafting step and never logged.
 */
export async function createAndSubmitAsk(input: NewAskInput): Promise<{ askId: string; state: AskState }> {
  const body = (input.body ?? "").trim();
  const tried = (input.tried ?? "").trim() || null;
  const confidential = (input.confidential ?? "").trim() || null;
  // Keeps the note out of the SQL trace lines of this request too.
  markSensitive(confidential);
  const urgency: AskUrgency = (URGENCIES as readonly string[]).includes(input.urgency ?? "") ? (input.urgency as AskUrgency) : "blocked_today";
  if (!input.urgency) log.branch("urgency blocked_today", "the optional urgency field was left closed or empty");

  if (body.length < ASK_BODY_MIN) {
    log.info(`ask refused: body is ${body.length} chars, needs at least ${ASK_BODY_MIN}`);
    throw new AppError("ASK_INVALID_INPUT", undefined, { status: 400 });
  }
  if (body.length > ASK_BODY_MAX || (tried?.length ?? 0) > ASK_EXTRA_MAX || (confidential?.length ?? 0) > ASK_EXTRA_MAX) {
    log.info("ask refused: a field is too long", { body: body.length, tried: tried?.length ?? 0, confidentialChars: confidential?.length ?? 0 });
    throw new AppError("ASK_INVALID_INPUT", `Keep the description under ${ASK_BODY_MAX} characters and the extra fields under ${ASK_EXTRA_MAX}.`, { status: 400 });
  }

  const viewer = await getViewer();
  const visitorId = viewer.user ? null : await ensureVisitorId();
  if (!viewer.personaId) {
    log.error("ask refused: no persona to ask as (company not seeded)");
    throw new AppError("SEED_EMPTY", undefined, { status: 503 });
  }
  const actorId = viewer.user?.id ?? visitorId ?? "visitor";
  // Asks made in the shared demo account are demo data, like a signed-out visitor's: Reset demo removes them.
  const source = !viewer.user || viewer.user.isDemo ? "demo" : "user";
  const askId = await insertAndSubmitAsk({ userId: viewer.user?.id ?? null, visitorId, personaId: viewer.personaId, actorId, source, body, tried, urgency, confidential, reason: "submitted from /ask/new" });
  log.info(`${askId} created by ${actorId} as ${viewer.personaId}`, {
    askId,
    urgency,
    source,
    bodyChars: body.length,
    hasTried: !!tried,
    // Only whether it exists: the note itself is never written to a log.
    hasConfidentialNote: !!confidential,
  });
  return { askId, state: "understanding" };
}

/**
 * Insert an ask in draft and submit it (draft -> understanding) in one transaction, for an owner
 * already decided. createAndSubmitAsk decides it from the request; the demo reset passes the demo
 * account (src/lib/demo.ts).
 */
export async function insertAndSubmitAsk(a: {
  userId: string | null;
  visitorId: string | null;
  personaId: string;
  actorId: string;
  source: "user" | "demo";
  body: string;
  tried: string | null;
  urgency: AskUrgency;
  confidential: string | null;
  reason: string;
}): Promise<string> {
  return getDb().transaction(async (tx) => {
    const [row] = await qIn(tx, "ask.insert", (h) =>
      h
        .insert(t.asks)
        .values({
          userId: a.userId,
          visitorId: a.visitorId,
          askerEmployeeId: a.personaId,
          title: titleFrom(a.body),
          body: a.body,
          tried: a.tried,
          urgency: a.urgency,
          confidential: a.confidential,
          status: "draft",
          source: a.source,
        })
        .returning({ id: t.asks.id }),
    );
    await recordCreated(tx, row.id, "draft", "user", a.actorId, a.reason.replace(/^submitted from/, "composed on"));
    await transitionAsk(
      { askId: row.id, to: "understanding", expectFrom: "draft", actor: "user", actorId: a.actorId, reason: a.reason, set: { progress: "queued", progressAt: wallNow() } },
      tx,
    );
    return row.id;
  });
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------

type AccessRow = { id: string; userId: string | null; visitorId: string | null; source: "seed" | "user" | "demo" };

/** One decision line per check. Someone else's ask looks exactly like a missing one (404). */
function canView(ask: AccessRow, v: Viewer): { ok: boolean; why: string } {
  if (ask.source === "seed") return { ok: true, why: "seeded history is synthetic and readable by anyone" };
  if (ask.userId && v.user?.id === ask.userId) return { ok: true, why: "viewer's own ask" };
  if (ask.visitorId && v.visitorId === ask.visitorId) return { ok: true, why: "same signed-out visitor cookie" };
  if (v.isAdmin) return { ok: true, why: "viewer is admin" };
  return { ok: false, why: ask.userId ? `belongs to ${ask.userId}` : "belongs to a different visitor" };
}

export async function assertAskAccess(askId: string, viewer?: Viewer): Promise<{ viewer: Viewer; ask: AccessRow }> {
  const v = viewer ?? (await getViewer());
  const rows = await q("ask.access", (db) => db.select({ id: t.asks.id, userId: t.asks.userId, visitorId: t.asks.visitorId, source: t.asks.source }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
  const ask = rows[0];
  if (!ask) {
    log.info(`auth decision: ${askId} not found for ${v.actorId}`, { askId });
    throw new AppError("ASK_NOT_FOUND", undefined, { status: 404, context: { askId } });
  }
  const d = canView(ask, v);
  if (!d.ok) {
    log.warn(`auth decision: deny ${askId} for ${v.actorId} (${d.why}), answering 404`, { askId });
    throw new AppError("ASK_NOT_FOUND", undefined, { status: 404, context: { askId } });
  }
  log.debug(`auth decision: allow ${askId} for ${v.actorId} (${d.why})`, { askId });
  return { viewer: v, ask };
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export type AskEventRow = { id: number; kind: string; fromState: AskState | null; toState: AskState | null; actor: string; actorId: string | null; reason: string; reqId: string | null; at: Date };

export async function getAskEvents(askId: string): Promise<AskEventRow[]> {
  return q("ask.events", (db) =>
    db
      .select({ id: t.askEvents.id, kind: t.askEvents.kind, fromState: t.askEvents.fromState, toState: t.askEvents.toState, actor: t.askEvents.actor, actorId: t.askEvents.actorId, reason: t.askEvents.reason, reqId: t.askEvents.reqId, at: t.askEvents.at })
      .from(t.askEvents)
      .where(eq(t.askEvents.askId, askId))
      .orderBy(t.askEvents.at, t.askEvents.id),
  );
}

export async function getAskDetail(askId: string) {
  const { viewer } = await assertAskAccess(askId);
  const asker = alias(t.employees, "asker");
  const routed = alias(t.employees, "routed");
  const [row] = await q("ask.detail", (db) =>
    db
      .select({
        id: t.asks.id,
        title: t.asks.title,
        body: t.asks.body,
        tried: t.asks.tried,
        urgency: t.asks.urgency,
        hasConfidential: sql<boolean>`${t.asks.confidential} is not null`,
        status: t.asks.status,
        source: t.asks.source,
        understanding: t.asks.understanding,
        retrieval: t.asks.retrieval,
        ranking: t.asks.ranking,
        progress: t.asks.progress,
        progressAt: t.asks.progressAt,
        lastErrorCode: t.asks.lastErrorCode,
        lastErrorReqId: t.asks.lastErrorReqId,
        createdAt: t.asks.createdAt,
        updatedAt: t.asks.updatedAt,
        askerId: asker.id,
        askerName: asker.name,
        askerTitle: asker.title,
        routedToId: routed.id,
        routedToName: routed.name,
        draft: t.asks.draft,
        sentAt: t.asks.sentAt,
        answeredVia: t.asks.answeredVia,
        answerNote: t.asks.answerNote,
        answeredById: t.asks.answeredById,
      })
      .from(t.asks)
      .leftJoin(asker, eq(asker.id, t.asks.askerEmployeeId))
      .leftJoin(routed, eq(routed.id, t.asks.routedToId))
      .where(eq(t.asks.id, askId))
      .limit(1),
  );
  const events = await getAskEvents(askId);
  log.debug(`${askId} loaded in state ${row.status} with ${events.length} events`, { askId, state: row.status });
  // Access already passed, so a non-seeded ask is the viewer's own (or the viewer is admin).
  // Seeded history is read only.
  return { ask: row, events, viewer, canAct: row.source !== "seed" };
}

export type AskDetail = Awaited<ReturnType<typeof getAskDetail>>;

/** Light status for the polling endpoint. */
export async function getAskStatus(askId: string) {
  await assertAskAccess(askId);
  const [row] = await q("ask.status", (db) =>
    db
      .select({ status: t.asks.status, retrieval: t.asks.retrieval, progress: t.asks.progress, progressAt: t.asks.progressAt, lastErrorCode: t.asks.lastErrorCode, lastErrorReqId: t.asks.lastErrorReqId, runLeaseUntil: t.asks.runLeaseUntil })
      .from(t.asks)
      .where(eq(t.asks.id, askId))
      .limit(1),
  );
  return { ...row, running: !!row.runLeaseUntil && row.runLeaseUntil.getTime() > wallMs() };
}

/** /dashboard: the viewer's asks, newest first, and the latest events across them. */
export async function listViewerAsks(viewer: Viewer) {
  const owner = viewer.user ? eq(t.asks.userId, viewer.user.id) : viewer.visitorId ? eq(t.asks.visitorId, viewer.visitorId) : null;
  if (!owner) {
    log.skip("load dashboard asks", "signed-out visitor without a visitor cookie has made no asks yet");
    return { open: [], closed: [], activity: [] };
  }
  const asks = await q("dashboard.asks", (db) =>
    db
      .select({ id: t.asks.id, title: t.asks.title, status: t.asks.status, urgency: t.asks.urgency, createdAt: t.asks.createdAt, updatedAt: t.asks.updatedAt, progress: t.asks.progress })
      .from(t.asks)
      .where(owner)
      .orderBy(desc(t.asks.updatedAt))
      .limit(100),
  );
  const ids = asks.map((a) => a.id);
  const activity = ids.length
    ? await q("dashboard.activity", (db) =>
        db
          .select({ id: t.askEvents.id, askId: t.askEvents.askId, title: t.asks.title, kind: t.askEvents.kind, fromState: t.askEvents.fromState, toState: t.askEvents.toState, actor: t.askEvents.actor, reason: t.askEvents.reason, at: t.askEvents.at })
          .from(t.askEvents)
          .innerJoin(t.asks, eq(t.asks.id, t.askEvents.askId))
          .where(and(inArray(t.askEvents.askId, ids)))
          .orderBy(desc(t.askEvents.at), desc(t.askEvents.id))
          .limit(12),
      )
    : [];
  const open = asks.filter((a) => isOpen(a.status));
  const closed = asks.filter((a) => !isOpen(a.status));
  log.debug(`dashboard: ${open.length} open and ${closed.length} closed asks for ${viewer.actorId}`, { states: countBy(asks.map((a) => a.status)) });
  return { open, closed, activity };
}

function countBy(xs: AskState[]): Partial<Record<AskState, number>> {
  const out: Partial<Record<AskState, number>> = {};
  for (const s of ASK_STATES) {
    const n = xs.filter((x) => x === s).length;
    if (n) out[s] = n;
  }
  return out;
}
