import "server-only";
// The understanding step. One understand_ask call through callModel (strict JSON, Zod-validated);
// in demo mode or when the call fails, the committed fixture for a composer example or the
// keyword extractor answers instead. Exactly one line says which path ran:
//
//   [ask.understand] INFO ask_1000 understood via=keywords (...)
//
// Then the documents are searched before any person (src/lib/doc-check.ts), and the ask stops in
// confirming so the asker can correct the chips and say whether a document already answers it.
// The confidential note is never read here and never sent to a model.

import { eq } from "drizzle-orm";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import type { StepContext, StepResult } from "./ask-pipeline";
import { getSessionUser } from "./auth";
import { findDocs } from "./doc-check";
import { embedText } from "./embed";
import { AppError } from "./errors";
import { createLogger } from "./log";
import { callModel } from "./model";
import { understandFixture } from "./model-purposes";
import { currentMode } from "./mode-request";
import { askText, buildUnderstanding, loadCatalog } from "./understand-build";
import { type ModelUnderstand, type UnderstandVia, understandingForLog } from "./understanding";

const log = createLogger("ask.understand");

export async function understandAsk({ askId, progress }: StepContext): Promise<StepResult> {
  await progress("reading your ask");
  const [ask] = await q("ask.understand.load", (db) => db.select({ body: t.asks.body, tried: t.asks.tried, urgency: t.asks.urgency }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
  if (!ask) throw new AppError("ASK_NOT_FOUND", undefined, { status: 404 });
  const text = askText(ask);
  const catalog = await loadCatalog();
  await progress(`matching your words against ${catalog.services.length} services and ${catalog.skills.length} skills`);

  const input = { askId, text, catalog };
  const [user, mode] = await Promise.all([getSessionUser(), currentMode()]);
  const r = await callModel({ purpose: "understand_ask", input, user, mode, askId });
  let output: ModelUnderstand;
  let via: UnderstandVia;
  let note: string | null = null;
  if (r.source === "live") {
    output = r.output;
    via = "model";
    log.branch(`${askId} understood via=model`, `live understand_ask answered in ${r.ms}ms (${r.usage.inputTokens + r.usage.outputTokens} tokens)`, { askId });
  } else {
    // callModel already served the demo result; ask again only to learn which kind it was, for the log.
    const recorded = r.source === "fixture" && r.fixture.kind === "recorded";
    const f = understandFixture(input);
    output = r.source === "fixture" ? r.output : f.output;
    via = recorded ? "fixture" : f.via;
    note = r.note;
    log.branch(`${askId} understood via=${via}`, `${r.outcome}: ${recorded ? `recorded live answer hash=${r.fixture.hash}` : f.detail}`, { askId, outcome: r.outcome });
  }

  const u = buildUnderstanding({ label: askId, text, catalog, output, via, note, askUrgency: ask.urgency });
  log.info(`${askId} understood via=${via}: ${u.services.length} services (${u.services.map((s) => s.name).join(", ") || "none"}), ${u.skills.length} skills (${u.skills.map((s) => s.name).join(", ") || "none"}), help ${u.helpKind}, urgency ${u.urgency}, ${u.artifacts.length} artifacts, ${u.sensitive.length} sensitive`, { askId });
  log.info(`${askId} understanding JSON ${JSON.stringify(understandingForLog(u))}`, { askId });

  const embedding = embedText(text);
  await q("ask.understand.save", (db) => db.update(t.asks).set({ understanding: u, embedding, retrieval: null }).where(eq(t.asks.id, askId)));

  await progress("checking runbooks and onboarding docs before searching people");
  const { hits, considered } = await findDocs({ label: askId, text, embedding, understanding: u });
  await getDb().transaction(async (tx) => {
    await qIn(tx, "ask.docs.clear", (h) => h.delete(t.askDocChecks).where(eq(t.askDocChecks.askId, askId)));
    if (hits.length)
      await qIn(tx, "ask.docs.insert", (h) =>
        h.insert(t.askDocChecks).values(hits.map((d, i) => ({ askId, documentId: d.documentId, rank: i + 1, score: d.score, section: d.section, why: d.why }))),
      );
  });
  await progress(hits.length ? `found ${hits.length === 1 ? "a document" : `${hits.length} documents`} that may already answer it` : `checked ${considered} documents, none covers it closely`);
  return {
    to: "confirming",
    reason: `understood via ${via}: ${u.services.map((s) => s.name).join(", ") || "no service named"}; ${hits.length} document(s) offered`,
    data: { via, services: u.services.map((s) => s.id), skills: u.skills.map((s) => s.id), helpKind: u.helpKind, docs: hits.map((h) => h.documentId) },
  };
}
