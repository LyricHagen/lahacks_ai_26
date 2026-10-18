import "server-only";
// The asker confirms (and corrects) what Who2Ask understood, and says whether an offered document
// already answers the ask. One action, one transition:
//
//   confirming -> answered     a document answered it (no person is bothered)
//   confirming -> retrieving   find a person; offered docs are recorded as not_answered
//
// Every correction is one short line in understanding.edits and in the log, so a wrong parse can
// be traced to what the asker had to fix. Sensitive spans are never logged.

import { wallNow } from "@/lib/clock";
import { and, eq } from "drizzle-orm";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import { transitionAsk } from "./ask-transition";
import { embedText } from "./embed";
import { AppError } from "./errors";
import { createLogger, markSensitive } from "./log";
import { askText, loadCatalog, protectUnderstanding } from "./understand-build";
import { type ConfirmInput, ConfirmInputSchema, HELP_KIND_LABEL, type NamedRef, normalizeUnderstanding, type Understanding } from "./understanding";
import type { Viewer } from "./viewer";

const log = createLogger("ask.confirm");

function diffRefs(kind: string, before: NamedRef[], after: NamedRef[]): string[] {
  const out: string[] = [];
  for (const b of before) if (!after.some((a) => a.id === b.id)) out.push(`removed ${kind} ${b.name}`);
  for (const a of after) if (!before.some((b) => b.id === a.id)) out.push(`added ${kind} ${a.name}`);
  return out;
}

export async function confirmAsk(raw: unknown, viewer: Viewer): Promise<{ askId: string; to: "answered" | "retrieving" }> {
  const parsed = ConfirmInputSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn(`confirm refused: input failed validation (${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")})`);
    throw new AppError("ASK_CONFIRM_INVALID", undefined, { status: 400 });
  }
  const input: ConfirmInput = parsed.data;
  for (const s of input.sensitive) markSensitive(s.text);
  const { askId } = input;

  const [ask] = await q("ask.confirm.load", (db) =>
    db.select({ status: t.asks.status, body: t.asks.body, tried: t.asks.tried, urgency: t.asks.urgency, understanding: t.asks.understanding }).from(t.asks).where(eq(t.asks.id, askId)).limit(1),
  );
  if (!ask) throw new AppError("ASK_NOT_FOUND", undefined, { status: 404 });
  if (ask.status !== "confirming") {
    log.warn(`${askId} confirm refused: ask is in ${ask.status}, not confirming (another tab already confirmed it?)`, { askId });
    throw new AppError("ASK_STATE_CONFLICT", undefined, { status: 409, context: { askId, current: ask.status } });
  }
  const before = normalizeUnderstanding(ask.understanding);
  if (!before) throw new AppError("ASK_CONFIRM_INVALID", "This ask has nothing to confirm yet.", { status: 409 });
  protectUnderstanding(before);

  const catalog = await loadCatalog();
  const resolve = (kind: string, ids: string[], all: Array<{ id: string; name: string }>, prev: NamedRef[]) =>
    [...new Set(ids)].flatMap((id) => {
      const hit = all.find((x) => x.id === id);
      if (!hit) {
        log.warn(`${askId} confirm dropped unknown ${kind} id "${id}"`, { askId });
        return [];
      }
      return [prev.find((p) => p.id === id) ?? { id, name: hit.name, matched: "added by you" }];
    });
  const services = resolve("service", input.serviceIds, catalog.services, before.services);
  const skills = resolve("skill", input.skillIds, catalog.skills, before.skills);

  const edits: string[] = [
    ...(input.restatement !== before.restatement ? ["rewrote the restatement"] : []),
    ...diffRefs("service", before.services, services),
    ...diffRefs("skill", before.skills, skills),
    ...before.artifacts.filter((b) => !input.artifacts.some((a) => a.kind === b.kind && a.text === b.text)).map((b) => `removed ${b.kind} "${b.text}"`),
    ...input.artifacts.filter((a) => !before.artifacts.some((b) => a.kind === b.kind && a.text === b.text)).map((a) => `added ${a.kind} "${a.text}"`),
    ...(input.helpKind !== before.helpKind ? [`help kind ${HELP_KIND_LABEL[before.helpKind]} to ${HELP_KIND_LABEL[input.helpKind]}`] : []),
    ...(input.urgency !== before.urgency ? [`urgency ${before.urgency} to ${input.urgency}`] : []),
    ...(() => {
      const removed = before.sensitive.filter((b) => !input.sensitive.some((s) => s.text === b.text)).length;
      const added = input.sensitive.filter((s) => !before.sensitive.some((b) => b.text === s.text)).length;
      return [...(removed ? [`removed ${removed} sensitive span(s)`] : []), ...(added ? [`added ${added} sensitive span(s)`] : [])];
    })(),
  ];
  if (edits.length) log.info(`${askId} corrected by ${viewer.actorId} (parse via=${before.via}): ${edits.join("; ")}`, { askId, edits: edits.length });
  else log.branch(`${askId} confirmed unchanged`, `the asker accepted the ${before.via} understanding as is`, { askId });

  const after: Understanding = {
    ...before,
    restatement: input.restatement,
    services,
    skills,
    artifacts: input.artifacts,
    helpKind: input.helpKind,
    urgency: input.urgency,
    sensitive: input.sensitive,
    editedByUser: before.editedByUser || edits.length > 0,
    edits: [...before.edits, ...edits],
  };
  const searchChanged = edits.some((e) => /restatement|service|skill/.test(e));
  // The corrected words should steer the similarity paths too, not only the ask as typed.
  const embedding = searchChanged ? embedText([askText(ask), after.restatement, ...services.map((s) => s.name), ...skills.map((s) => s.name)].join("\n")) : undefined;
  if (searchChanged) log.branch(`${askId} re-embed the ask`, "services, skills or the restatement changed", { askId });

  const docs = await q("ask.confirm.docs", (db) => db.select({ documentId: t.askDocChecks.documentId, title: t.documents.title }).from(t.askDocChecks).innerJoin(t.documents, eq(t.documents.id, t.askDocChecks.documentId)).where(eq(t.askDocChecks.askId, askId)));
  const answeredBy = input.answeredByDocId ? docs.find((d) => d.documentId === input.answeredByDocId) : null;
  if (input.answeredByDocId && !answeredBy) {
    log.warn(`${askId} confirm refused: document ${input.answeredByDocId} was not offered for this ask`, { askId });
    throw new AppError("ASK_CONFIRM_INVALID", "That document was not offered for this ask.", { status: 400 });
  }

  const to = answeredBy ? ("answered" as const) : ("retrieving" as const);
  await getDb().transaction(async (tx) => {
    await qIn(tx, "ask.confirm.save", (h) => h.update(t.asks).set({ understanding: after, urgency: after.urgency, ...(embedding ? { embedding } : {}) }).where(eq(t.asks.id, askId)));
    const now = wallNow();
    for (const d of docs) {
      const verdict = d.documentId === answeredBy?.documentId ? "answered" : "not_answered";
      await qIn(tx, "ask.confirm.verdict", (h) => h.update(t.askDocChecks).set({ verdict, verdictAt: now }).where(and(eq(t.askDocChecks.askId, askId), eq(t.askDocChecks.documentId, d.documentId))));
    }
    await transitionAsk(
      answeredBy
        ? {
            askId,
            to,
            expectFrom: "confirming",
            actor: "user",
            actorId: viewer.actorId,
            reason: `answered by document ${answeredBy.documentId} "${answeredBy.title}"`,
            data: { docId: answeredBy.documentId, edits: edits.length, via: "document" },
            // The outcome /insights reads: nobody was interrupted, a document did it.
            set: { answeredVia: "document", answeredDocId: answeredBy.documentId },
          }
        : {
            askId,
            to,
            expectFrom: "confirming",
            actor: "user",
            actorId: viewer.actorId,
            reason: `confirmed${edits.length ? ` with ${edits.length} correction(s)` : ""}; ${docs.length ? `docs did not answer it: ${docs.map((d) => d.documentId).join(", ")}` : "no doc was offered"}`,
            data: { edits: edits.length, docsNotAnswered: docs.map((d) => d.documentId) },
            set: { progress: "queued", progressAt: wallNow() },
          },
      tx,
    );
  });
  if (docs.length) {
    if (answeredBy) log.info(`${askId} outcome: answered via=document ${answeredBy.documentId}, nobody was interrupted (asks.answered_via, read by /insights)`, { askId });
    if (answeredBy) log.info(`${askId} doc verdict: ${answeredBy.documentId} answered it${docs.length > 1 ? `; ${docs.filter((d) => d !== answeredBy).map((d) => d.documentId).join(", ")} not_answered` : ""}`, { askId });
    else log.info(`${askId} doc verdict: not_answered for ${docs.map((d) => d.documentId).join(", ")} (signal for /insights: these docs did not help)`, { askId });
  }
  return { askId, to };
}
