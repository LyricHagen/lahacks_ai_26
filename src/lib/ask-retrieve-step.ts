import "server-only";
// The retrieving step: run the five retrieval paths (src/lib/retrieve.ts), write the candidates
// with their evidence to ask_candidates, and move to ranking. Each finished path is written to
// asks.retrieval so the ask page shows the count per source as it arrives.

import { eq } from "drizzle-orm";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import type { StepContext, StepResult } from "./ask-pipeline";
import { askText, protectUnderstanding } from "./understand-build";
import { embedText } from "./embed";
import { AppError } from "./errors";
import { getClock } from "./clock-request";
import { createLogger } from "./log";
import { span } from "./observe";
import { emptyRetrieval, type RetrievalSummary, retrieveCandidates } from "./retrieve";
import { normalizeUnderstanding } from "./understanding";

const log = createLogger("ask.retrieve");

export async function retrieveAsk({ askId, progress }: StepContext): Promise<StepResult> {
  const [ask] = await q("ask.retrieve.load", (db) =>
    db.select({ body: t.asks.body, tried: t.asks.tried, understanding: t.asks.understanding, embedding: t.asks.embedding, askerId: t.asks.askerEmployeeId }).from(t.asks).where(eq(t.asks.id, askId)).limit(1),
  );
  if (!ask) throw new AppError("ASK_NOT_FOUND", undefined, { status: 404 });
  const u = normalizeUnderstanding(ask.understanding);
  if (!u) throw new AppError("ASK_STEP_FAILED", "The ask has no understanding to search with.", { context: { askId } });
  protectUnderstanding(u);
  const text = askText(ask);
  let embedding = ask.embedding;
  if (!embedding) {
    log.branch(`${askId} embed now`, "the ask has no stored embedding (made before prompt 4 stored one)", { askId });
    embedding = embedText(text);
  }

  await progress(`searching the company for ${u.services.map((s) => s.name).join(", ") || "people close to your ask"}`);
  const live: RetrievalSummary = emptyRetrieval();
  await q("ask.retrieve.reset", (db) => db.update(t.asks).set({ retrieval: live }).where(eq(t.asks.id, askId)));

  const { candidates, summary } = await span("ask.retrieve", "ai.retrieval", { ask_id: askId }, async () =>
    retrieveCandidates({
    label: askId,
    // The restatement and confirmed names count as the asker's words for the semantic and doc paths.
    text: [text, u.restatement, ...u.services.map((s) => s.name), ...u.skills.map((s) => s.name)].join("\n"),
    understanding: u,
    embedding,
    askerId: ask.askerId,
    now: (await getClock()).now,
    onPath: async (s, all) => {
      await q("ask.retrieve.path", (db) => db.update(t.asks).set({ retrieval: { ...live, paths: all } }).where(eq(t.asks.id, askId)));
      await progress(s.status === "skipped" ? `${s.label.toLowerCase()}: skipped, ${s.note}` : `${s.label.toLowerCase()}: ${s.people} ${s.people === 1 ? "person" : "people"}`);
    },
    }),
  );

  await getDb().transaction(async (tx) => {
    await qIn(tx, "ask.candidates.clear", (h) => h.delete(t.askCandidates).where(eq(t.askCandidates.askId, askId)));
    if (candidates.length)
      await qIn(tx, "ask.candidates.insert", (h) =>
        h.insert(t.askCandidates).values(
          candidates.map((c) => ({ askId, employeeId: c.employeeId, rank: null, score: null, sources: c.sources, evidence: c.evidence, breakdown: { stage: "retrieved", sources: c.sources } })),
        ),
      );
    await qIn(tx, "ask.retrieve.summary", (h) => h.update(t.asks).set({ retrieval: summary }).where(eq(t.asks.id, askId)));
  });
  await progress(candidates.length ? `${candidates.length} people to consider${summary.cut.length ? ` (${summary.cut.length} more had weaker evidence)` : ""}` : "nobody matched; try naming the service or tool");

  return {
    to: "ranking",
    reason: `retrieved ${candidates.length} candidates (${summary.paths.map((p) => `${p.path} ${p.people}`).join(", ")})`,
    data: { total: candidates.length, beforeCap: summary.beforeCap, byPath: Object.fromEntries(summary.paths.map((p) => [p.path, p.people])) },
  };
}
