// Doc check history for the seeded asks, generated at load time (like calendars), so /insights
// has a "where documentation failed" signal before anyone uses the app. Deterministic for a seed.
//
// Every seeded ask was routed to a person, so any document offered for it did not answer it: each
// row here is verdict not_answered. A few documents are planted as failing often (PLANTED_DOC_FAILURES);
// the rest fail at BASE_RATE. The planted ones are listed in [seed.summary].

import type { Company } from "./fixture";
import { createRng } from "./rng";

/** Share of a service's seeded asks for which the planted doc was offered and did not answer. */
export const PLANTED_DOC_FAILURES: Record<string, number> = {
  doc_mobile_build_runbook: 0.8,
  doc_billing_overview: 0.65,
  doc_k8s_runbook: 0.85,
  doc_ingest_overview: 0.7,
};
/** For any other doc about a seeded ask's service. */
export const BASE_RATE = 0.15;

export type DocCheckRow = { askId: string; documentId: string; rank: number; score: number; section: string; why: string; verdict: "not_answered" };

/** Rows for ask_doc_checks; the caller sets createdAt and verdictAt from the ask's own time. */
export function generateDocHistory(c: Company): DocCheckRow[] {
  const rng = createRng(`${c.seed}::doc-history`);
  const svcName = new Map(c.services.map((s) => [s.id, s.name]));
  const docsBySvc = new Map<string, Company["documents"]>();
  for (const d of c.documents) if (d.serviceId) docsBySvc.set(d.serviceId, [...(docsBySvc.get(d.serviceId) ?? []), d]);
  const rows: DocCheckRow[] = [];
  for (const a of c.asks) {
    const docs = docsBySvc.get(a.serviceId) ?? [];
    // Planted docs first, then overview docs before runbooks, so one doc per ask is offered.
    const ordered = [...docs].sort((x, y) => Number(!!PLANTED_DOC_FAILURES[y.id]) - Number(!!PLANTED_DOC_FAILURES[x.id]) || (x.kind === "onboarding" ? -1 : 1) - (y.kind === "onboarding" ? -1 : 1));
    const doc = ordered[0];
    if (!doc) continue;
    const planted = PLANTED_DOC_FAILURES[doc.id];
    if (!rng.chance(planted ?? BASE_RATE)) continue;
    const firstPara = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 40) ?? doc.body;
    rows.push({
      askId: a.id,
      documentId: doc.id,
      rank: 1,
      score: Math.round((0.5 + rng.next() * 0.2) * 1000) / 1000,
      section: firstPara.trim().slice(0, 600),
      why: `seeded history: offered for a question about ${svcName.get(a.serviceId) ?? a.serviceId} before it was routed to a person`,
      verdict: "not_answered",
    });
  }
  return rows;
}
