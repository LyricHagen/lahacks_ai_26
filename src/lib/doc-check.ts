import "server-only";
// Before searching people, search the documents. If a runbook or onboarding doc covers the ask,
// the confirm screen offers it first with the matching paragraph quoted: the best ask is the one
// nobody has to answer. What the asker says about each doc is kept in ask_doc_checks, so the
// insights page can find docs that fail new hires.
//
// Score = mean of the whole doc's cosine similarity (pgvector, same local embedding as the seed)
// and its best paragraph's similarity (title plus paragraph): a doc that covers the question has
// one paragraph that reads like the answer. Only docs at or above DOC_MIN_SCORE are offered, and a
// second doc only when it is nearly as close as the first.

import { cosineDistance, eq, inArray, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { cosine, embedText, tokenize } from "./embed";
import { createLogger } from "./log";
import type { Understanding } from "./understanding";

const log = createLogger("ask.docs");

/**
 * Calibrated with pnpm retrieve:check on corvid-v1: the six documented scenarios score 0.51 to
 * 0.75, the seven person-only scenarios at most 0.47.
 */
export const DOC_MIN_SCORE = 0.49;
/** A second doc is offered only within this distance of the first. */
const SECOND_DOC_MARGIN = 0.06;
const MAX_DOCS = 2;
const POOL = 8;

export type DocHit = {
  documentId: string;
  title: string;
  kind: string;
  authorId: string;
  serviceId: string | null;
  updatedOn: string;
  score: number;
  similarity: number;
  section: string;
  why: string;
};

/** Words both texts use (compared after stemming, shown as the asker wrote them), longest first. */
export function sharedWords(a: string, b: string, max = 4): string[] {
  const bs = new Set(tokenize(b));
  const out = new Map<string, string>();
  for (const word of a.match(/[A-Za-z][A-Za-z0-9+#-]*/g) ?? []) {
    const stem = tokenize(word)[0];
    if (stem && bs.has(stem) && !out.has(stem)) out.set(stem, word.toLowerCase());
  }
  return [...out.values()].sort((x, y) => y.length - x.length).slice(0, max);
}

/**
 * The best paragraph for the ask. Two numbers: `similarity` (paragraph embedded with the doc title,
 * so a step reads in context) feeds the doc score; the quote is chosen by the paragraph alone,
 * leaning slightly toward earlier paragraphs (runbooks put the how before the cleanup), and takes
 * the next paragraph with it while the quote stays short.
 */
export function bestSection(title: string, body: string, askVec: number[]): { section: string; similarity: number } {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return { section: body.slice(0, 400), similarity: 0 };
  const similarity = Math.max(...paras.map((p) => cosine(askVec, embedText(`${title}\n${p}`))));
  let best = 0;
  let bestScore = -Infinity;
  paras.forEach((p, i) => {
    const s = cosine(askVec, embedText(p)) - 0.03 * i;
    if (s > bestScore) (bestScore = s), (best = i);
  });
  let quote = paras[best];
  if (paras[best + 1] && quote.length + paras[best + 1].length < 480) quote = `${quote}\n\n${paras[best + 1]}`;
  return { section: quote.length > 600 ? `${quote.slice(0, 597).trimEnd()}...` : quote, similarity };
}

export async function findDocs(args: { label: string; text: string; embedding: number[]; understanding: Understanding }): Promise<{ hits: DocHit[]; considered: number }> {
  const { label, text, embedding, understanding: u } = args;
  const serviceIds = u.services.map((s) => s.id);
  const t0 = performance.now();
  const near = await q("ask.docs.near", (db) =>
    db
      .select({ id: t.documents.id, distance: cosineDistance(t.documents.embedding, embedding) })
      .from(t.documents)
      .orderBy(cosineDistance(t.documents.embedding, embedding))
      .limit(POOL),
  );
  const byService = serviceIds.length
    ? await q("ask.docs.by_service", (db) => db.select({ id: t.documents.id }).from(t.documents).where(inArray(t.documents.serviceId, serviceIds)))
    : [];
  const ids = [...new Set([...near.map((r) => r.id), ...byService.map((r) => r.id)])];
  if (!ids.length) {
    log.skip(`${label} doc check`, "the documents table is empty");
    return { hits: [], considered: 0 };
  }
  const docs = await q("ask.docs.load", (db) =>
    db
      .select({
        id: t.documents.id,
        title: t.documents.title,
        kind: t.documents.kind,
        authorId: t.documents.authorId,
        serviceId: t.documents.serviceId,
        body: t.documents.body,
        updatedOn: t.documents.updatedOn,
        serviceName: t.services.name,
        similarity: sql<number>`1 - (${cosineDistance(t.documents.embedding, embedding)})`,
      })
      .from(t.documents)
      .leftJoin(t.services, eq(t.services.id, t.documents.serviceId))
      .where(inArray(t.documents.id, ids)),
  );
  const scored = docs
    .map((d) => {
      const similarity = Number(d.similarity);
      const aboutNamed = !!d.serviceId && serviceIds.includes(d.serviceId);
      const best = bestSection(d.title, d.body, embedding);
      const score = (similarity + best.similarity) / 2;
      const words = sharedWords(text, `${d.title}\n${d.body}`);
      const why = [aboutNamed ? `about ${d.serviceName}, a service in your ask` : null, words.length ? `shares the words ${words.join(", ")}` : null].filter(Boolean).join(", and ") || "close in wording to your ask";
      return { d, similarity, paragraph: best.similarity, section: best.section, score, why: why.charAt(0).toUpperCase() + why.slice(1) };
    })
    .sort((a, b) => b.score - a.score);
  for (const s of scored.slice(0, 5)) {
    log.debug(`${label} doc ${s.d.id} score ${s.score.toFixed(3)} (doc ${s.similarity.toFixed(3)}, best paragraph ${s.paragraph.toFixed(3)}) ${s.score >= DOC_MIN_SCORE ? "over" : "under"} ${DOC_MIN_SCORE}`, { title: s.d.title });
  }
  const hits: DocHit[] = scored
    .filter((s, i, all) => s.score >= DOC_MIN_SCORE && (i === 0 || s.score >= all[0].score - SECOND_DOC_MARGIN))
    .slice(0, MAX_DOCS)
    .map((s) => ({
      documentId: s.d.id,
      title: s.d.title,
      kind: s.d.kind,
      authorId: s.d.authorId,
      serviceId: s.d.serviceId,
      updatedOn: s.d.updatedOn,
      score: Math.round(s.score * 1000) / 1000,
      similarity: Math.round(s.similarity * 1000) / 1000,
      section: s.section,
      why: s.why,
    }));
  const ms = Math.round(performance.now() - t0);
  if (hits.length) log.branch(`${label} offer ${hits.length} document(s) before searching people`, `${hits.map((h) => `${h.documentId} ${h.score}`).join(", ")} at or above ${DOC_MIN_SCORE}`);
  else log.branch(`${label} offer no document`, `best was ${scored[0] ? `${scored[0].d.id} ${scored[0].score.toFixed(3)}` : "none"}, below ${DOC_MIN_SCORE}`);
  log.info(`${label} doc check: ${scored.length} docs considered (${near.length} nearest, ${byService.length} about named services), ${hits.length} offered in ${ms}ms`, {
    offered: hits.map((h) => h.documentId),
  });
  return { hits, considered: scored.length };
}
