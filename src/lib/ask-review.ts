import "server-only";
// What the ask page shows around the confirm and retrieval steps: the documents offered (with the
// asker's verdicts), the candidates with their evidence, and the per-path retrieval counts.
// Access is checked by getAskDetail before this runs.

import { asc, eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { asDraftSummary, type DraftSummary } from "./ask-draft-step";
import type { RankedBreakdown, ReasonSource, RankingSummary } from "./ask-rank-step";
import { type DraftFormat, type DraftVariant, DRAFT_VARIANTS, isDraftFormat } from "./draft";
import { createLogger } from "./log";
import type { Features } from "./rank";
import type { Evidence, RetrievalPath, RetrievalSummary } from "./retrieve";

const log = createLogger("ask.review");

export type DocCheckView = {
  documentId: string;
  title: string;
  kind: string;
  authorId: string;
  authorName: string;
  serviceName: string | null;
  updatedOn: string;
  score: number;
  section: string;
  why: string;
  verdict: string | null;
};

export type CandidateView = { employeeId: string; name: string; title: string; team: string; sources: RetrievalPath[]; evidence: Evidence[] };

export async function getDocChecks(askId: string): Promise<DocCheckView[]> {
  const rows = await q("ask.review.docs", (db) =>
    db
      .select({
        documentId: t.askDocChecks.documentId,
        title: t.documents.title,
        kind: t.documents.kind,
        authorId: t.documents.authorId,
        authorName: t.employees.name,
        serviceName: t.services.name,
        updatedOn: t.documents.updatedOn,
        score: t.askDocChecks.score,
        section: t.askDocChecks.section,
        why: t.askDocChecks.why,
        verdict: t.askDocChecks.verdict,
      })
      .from(t.askDocChecks)
      .innerJoin(t.documents, eq(t.documents.id, t.askDocChecks.documentId))
      .innerJoin(t.employees, eq(t.employees.id, t.documents.authorId))
      .leftJoin(t.services, eq(t.services.id, t.documents.serviceId))
      .where(eq(t.askDocChecks.askId, askId))
      .orderBy(asc(t.askDocChecks.rank)),
  );
  return rows;
}

export async function getCandidates(askId: string): Promise<CandidateView[]> {
  const rows = await q("ask.review.candidates", (db) =>
    db
      .select({ employeeId: t.askCandidates.employeeId, name: t.employees.name, title: t.employees.title, team: t.employees.team, sources: t.askCandidates.sources, evidence: t.askCandidates.evidence })
      .from(t.askCandidates)
      .innerJoin(t.employees, eq(t.employees.id, t.askCandidates.employeeId))
      .where(eq(t.askCandidates.askId, askId))
      .orderBy(asc(t.employees.name)),
  );
  log.debug(`${askId} ${rows.length} candidates loaded for the page`, { askId });
  return rows.map((r) => ({ ...r, sources: r.sources as RetrievalPath[], evidence: (r.evidence as Evidence[]) ?? [] }));
}

export function asRetrieval(raw: unknown): RetrievalSummary | null {
  return raw && typeof raw === "object" && Array.isArray((raw as RetrievalSummary).paths) ? (raw as RetrievalSummary) : null;
}

/** One ranked candidate as the shortlist needs it: stored features (re-scored on the client), evidence, reason. */
export type RankedPerson = {
  features: Features;
  evidence: Evidence[];
  sources: RetrievalPath[];
  reason: string | null;
  reasonSource: ReasonSource;
  reasonDropped: number;
  chosen: boolean;
};

export type RankingView = { summary: RankingSummary; people: RankedPerson[] };

export function asRanking(raw: unknown): RankingSummary | null {
  return raw && typeof raw === "object" && (raw as RankingSummary).version === 1 && Array.isArray((raw as RankingSummary).guardrails) ? (raw as RankingSummary) : null;
}

export async function getRanking(askId: string, raw: unknown): Promise<RankingView | null> {
  const summary = asRanking(raw);
  if (!summary) {
    log.skip(`${askId} ranking view`, "the ask has no ranking summary yet");
    return null;
  }
  const rows = await q("ask.review.ranked", (db) =>
    db
      .select({ breakdown: t.askCandidates.breakdown, evidence: t.askCandidates.evidence, sources: t.askCandidates.sources, explanation: t.askCandidates.explanation, chosen: t.askCandidates.chosen })
      .from(t.askCandidates)
      .where(eq(t.askCandidates.askId, askId)),
  );
  const people: RankedPerson[] = [];
  let stale = 0;
  for (const r of rows) {
    const b = r.breakdown as Partial<RankedBreakdown>;
    if (b.stage !== "ranked" || !b.features) {
      stale++;
      continue;
    }
    people.push({
      features: b.features,
      evidence: (r.evidence as Evidence[]) ?? [],
      sources: r.sources as RetrievalPath[],
      reason: r.explanation,
      reasonSource: b.reasonSource ?? "template",
      reasonDropped: b.reasonDropped?.length ?? 0,
      chosen: r.chosen,
    });
  }
  if (stale) log.warn(`${askId} ${stale} candidate rows have no ranked breakdown (ranked with an older config?); left out of the shortlist view`, { askId });
  log.debug(`${askId} ranking view: ${people.length} people, top ${summary.topId}`, { askId });
  return { summary, people };
}

// ---------------------------------------------------------------------------
// the draft (prompt 8)
// ---------------------------------------------------------------------------

export type DraftMessageView = { variant: DraftVariant; format: DraftFormat; subject: string; body: string; originalSubject: string; originalBody: string; status: string; source: string };
export type DraftView = { summary: DraftSummary; messages: Record<DraftVariant, DraftMessageView> };

/** The drafts of an ask, one per variant, and what the drafting step decided. Null before drafting ran. */
export async function getDraftView(askId: string, raw: unknown): Promise<DraftView | null> {
  const summary = asDraftSummary(raw);
  if (!summary) {
    log.skip(`${askId} draft view`, "the ask has no draft yet");
    return null;
  }
  const rows = await q("ask.review.drafts", (db) =>
    db
      .select({ variant: t.askMessages.variant, channel: t.askMessages.channel, subject: t.askMessages.subject, body: t.askMessages.body, originalSubject: t.askMessages.originalSubject, originalBody: t.askMessages.originalBody, status: t.askMessages.status, source: t.askMessages.source })
      .from(t.askMessages)
      .where(eq(t.askMessages.askId, askId)),
  );
  const messages = {} as Record<DraftVariant, DraftMessageView>;
  for (const v of DRAFT_VARIANTS) {
    const r = rows.find((x) => x.variant === v);
    if (!r) {
      log.warn(`${askId} draft view: no ${v} message row (drafted by an older version?)`, { askId });
      return null;
    }
    messages[v] = {
      variant: v,
      format: isDraftFormat(r.channel) ? r.channel : summary.suggested.format,
      subject: r.subject ?? "",
      body: r.body,
      originalSubject: r.originalSubject ?? "",
      originalBody: r.originalBody ?? r.body,
      status: r.status,
      source: r.source,
    };
  }
  log.debug(`${askId} draft view: ${DRAFT_VARIANTS.map((v) => `${v}=${messages[v].status}`).join(" ")}, suggested ${summary.suggested.variant}/${summary.suggested.format}`, { askId });
  return { summary, messages };
}
