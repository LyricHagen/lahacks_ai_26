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
import { applyGlossary, extrasSearchText, readGlossary, readScreenshot } from "./ask-understand-extras";
import { AppError } from "./errors";
import { createLogger } from "./log";
import { callModel } from "./model";
import { understandFixture } from "./model-purposes";
import { currentMode } from "./mode-request";
import { askText, buildUnderstanding, loadCatalog } from "./understand-build";
import { type ModelUnderstand, type ParseInfo, type UnderstandVia, understandingForLog } from "./understanding";

/** Plain names for the tier that read the ask, as the asker sees them. */
const TIER_NAME: Record<string, string> = {
  finetune: "the fine-tuned model (Qwen2.5 1.5B + LoRA on Veri)",
  frontier: "Claude Haiku 5.5",
  sonnet: "Claude Sonnet 5.5",
  base: "the base Qwen2.5 1.5B model",
  deterministic: "the keyword reader",
};

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

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
  // Company jargon first (FEATURE_CREAO_GLOSSARY), so its services join the reading before retrieval.
  const glossary = await readGlossary({ askId, text, catalog, user, mode, progress });
  const t0 = performance.now();
  const r = await callModel({ purpose: "understand_ask", input, user, mode, askId });
  const callMs = Math.round(performance.now() - t0);
  let parse: ParseInfo;
  if (r.source === "live") {
    const fellBack = r.tier !== "finetune" && r.tierNote.includes("finetune failed");
    parse = { tier: r.tier, ms: r.ms, model: r.model, recorded: false, line: `Parsed in ${fmtMs(r.ms)} by ${TIER_NAME[r.tier] ?? r.model}${fellBack ? " (the fine-tuned model did not answer in time)" : ""}.` };
  } else if (r.source === "fixture" && r.fixture.recorded) {
    const rec = r.fixture.recorded;
    parse = { tier: rec.tier, ms: rec.ms, model: rec.model, recorded: true, line: `Parsed in ${fmtMs(rec.ms)} by ${TIER_NAME[rec.tier] ?? rec.model} (recorded live run, replayed in demo mode).` };
  } else {
    parse = { tier: "deterministic", ms: callMs, model: "keywords", recorded: false, line: `Parsed in ${fmtMs(callMs)} by ${TIER_NAME.deterministic} (no live model in demo mode).` };
  }
  log.info(`${askId} parse ${parse.tier} ${parse.ms}ms${parse.recorded ? " (recorded)" : ""}: ${parse.line}`, { askId });
  await progress(parse.line.replace(/^Parsed/, "parsed").replace(/\.$/, ""));
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

  const u = buildUnderstanding({ label: askId, text, catalog, output, via, note, askUrgency: ask.urgency, parse });
  applyGlossary(askId, u, glossary, catalog);
  // An attached screenshot (FEATURE_STEPFUN_VISION), read into the same structure and unioned in.
  await readScreenshot({ askId, text, catalog, user, mode, progress, into: u });
  log.info(`${askId} understood via=${via}: ${u.services.length} services (${u.services.map((s) => s.name).join(", ") || "none"}), ${u.skills.length} skills (${u.skills.map((s) => s.name).join(", ") || "none"}), help ${u.helpKind}, urgency ${u.urgency}, ${u.artifacts.length} artifacts, ${u.sensitive.length} sensitive`, { askId });
  log.info(`${askId} understanding JSON ${JSON.stringify(understandingForLog(u))}`, { askId });

  const extra = extrasSearchText(u);
  if (extra) log.branch(`${askId} embed the ask with glossary meanings and screenshot text`, `${extra.length} extra chars from ${[u.glossary?.hits.length ? "glossary" : "", u.screenshot?.via && u.screenshot.via !== "none" ? "screenshot" : ""].filter(Boolean).join(" and ")}`, { askId });
  const embedding = embedText(extra ? `${text}\n${extra}` : text);
  await q("ask.understand.save", (db) => db.update(t.asks).set({ understanding: u, embedding, retrieval: null }).where(eq(t.asks.id, askId)));

  await progress("checking runbooks and onboarding docs before searching people");
  const { hits, considered } = await findDocs({ label: askId, text: extra ? `${text}\n${extra}` : text, embedding, understanding: u });
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
