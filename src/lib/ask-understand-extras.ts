import "server-only";
// The two sponsor readings inside the understanding step, each behind its flag (src/lib/flags.ts):
//
//   glossary    resolve_jargon (CREAO glossary agent): Ferndale jargon in the ask -> services, skills
//               and meanings, BEFORE the text reading, so retrieval searches for what the jargon means.
//   screenshot  read_screenshot (StepFun step-5-preview): an attached image -> the same structure as
//               the text path (services, skills, error signatures), unioned into the understanding.
//
// Both go through callModel like every model call. Both log one line per decision and per hit:
//   [ask.understand] INFO ask_1000 glossary via=creao: 2 terms ("the till" -> glo_till, ...), 1 unknown
//   [ask.understand] INFO ask_1000 screenshot via=stepfun in 3120ms: +1 service, 2 errors
// Flag off: the step logs "skipped: ... glossary" and the ask is read exactly as before.

import { eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import type { SessionUser } from "./auth";
import { flagOn } from "./flags";
import { type GlossaryReading, type JargonHit, resolveJargonLocally } from "./glossary";
import { createLogger, markSensitive } from "./log";
import { callModel } from "./model";
import type { Mode, ResolvedMode } from "./mode";
import { type Catalog, detectSensitive, type ModelUnderstand, type ScreenshotReading, type Understanding } from "./understanding";

const log = createLogger("ask.understand");

type Ctx = { askId: string; text: string; catalog: Catalog; user: SessionUser | null; mode: ResolvedMode | Mode; progress: (line: string) => Promise<void> };

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** The glossary reading, or null when FEATURE_CREAO_GLOSSARY is off. */
export async function readGlossary(c: Ctx): Promise<GlossaryReading | null> {
  if (!flagOn("creao_glossary", `${c.askId} understanding`)) {
    log.skip(`${c.askId} glossary`, "FEATURE_CREAO_GLOSSARY is off, so company jargon is not resolved");
    return null;
  }
  await c.progress("looking up Ferndale jargon with the glossary agent");
  const t0 = performance.now();
  const r = await callModel({ purpose: "resolve_jargon", input: { askId: c.askId, text: c.text }, user: c.user, mode: c.mode, askId: c.askId });
  const ms = Math.round(performance.now() - t0);
  const local = resolveJargonLocally(c.text);
  let hits: JargonHit[];
  let unknown: string[] = [];
  let via: GlossaryReading["via"];
  let note: string | null = null;
  if (r.source === "live") {
    via = "creao";
    hits = r.output.hits;
    unknown = r.output.unknown;
    // Exact matches are facts: never let the agent lose one.
    const missed = local.hits.filter((l) => !hits.some((h) => h.glossaryId === l.glossaryId));
    if (missed.length) log.branch(`${c.askId} add exact glossary matches to the agent's answer`, `the agent missed ${missed.map((m) => `"${m.phrase}"`).join(", ")}`, { askId: c.askId });
    hits = [...hits, ...missed];
    log.info(`${c.askId} glossary via=creao answered in ${ms}ms (${r.tierNote})`, { askId: c.askId });
  } else {
    via = r.source === "fixture" && r.fixture.kind === "recorded" ? "recorded" : "local";
    hits = r.source === "fixture" ? r.output.hits : local.hits;
    unknown = r.source === "fixture" ? r.output.unknown : [];
    note = r.note;
    log.branch(`${c.askId} glossary via=${via}`, `${r.outcome}: ${via === "recorded" ? `recorded agent answer hash=${r.source === "fixture" ? r.fixture.hash : "?"}` : "exact whole-word matches of the glossary terms"}`, { askId: c.askId, outcome: r.outcome });
  }
  for (const h of hits) log.info(`${c.askId} glossary hit "${h.phrase}" -> ${h.glossaryId} (${h.term}): services ${h.serviceIds.join(", ") || "none"}, skills ${h.skillIds.join(", ") || "none"}, confidence ${h.confidence}`, { askId: c.askId });
  if (unknown.length) log.info(`${c.askId} glossary unknown jargon: ${unknown.map((u) => `"${u}"`).join(", ")} (not in the glossary)`, { askId: c.askId });
  log.info(`${c.askId} glossary via=${via}: ${hits.length} term(s), ${unknown.length} unknown, ${fmtMs(ms)}`, { askId: c.askId });
  await c.progress(hits.length ? `read ${hits.length === 1 ? `"${hits[0].phrase}" as ${hits[0].term}` : `${hits.length} company terms`}` : "no company jargon in your ask");
  return { hits, unknown, via, note, ms };
}

/** Add a reading's services and skills to the understanding, marked with where they came from. Returns what was new. */
function addRefs(u: Understanding, catalog: Catalog, serviceIds: string[], skillIds: string[], matched: string): { services: string[]; skills: string[] } {
  const services: string[] = [];
  const skills: string[] = [];
  for (const id of serviceIds) {
    const s = catalog.services.find((x) => x.id === id);
    if (s && !u.services.some((x) => x.id === id)) {
      u.services.push({ id, name: s.name, matched });
      services.push(id);
    }
  }
  for (const id of skillIds) {
    const s = catalog.skills.find((x) => x.id === id);
    if (s && !u.skills.some((x) => x.id === id)) {
      u.skills.push({ id, name: s.name, matched });
      skills.push(id);
    }
  }
  return { services, skills };
}

/** Put the glossary hits on the understanding (in place). */
export function applyGlossary(askId: string, u: Understanding, g: GlossaryReading | null, catalog: Catalog): void {
  if (!g) return;
  u.glossary = g;
  for (const h of g.hits) {
    const added = addRefs(u, catalog, h.serviceIds, h.skillIds, `glossary "${h.phrase}"`);
    log.branch(`${askId} glossary "${h.phrase}" adds ${added.services.length} service(s), ${added.skills.length} skill(s)`, added.services.length || added.skills.length ? `${[...added.services, ...added.skills].join(", ")} not found by the text reading` : "the text reading already had them");
  }
}

/** The attached screenshot, read and then deleted. Null when the ask has none. */
export async function readScreenshot(c: Ctx & { into: Understanding }): Promise<void> {
  const rows = await q("ask.attachment.load", (db) => db.select().from(t.askAttachments).where(eq(t.askAttachments.askId, c.askId)).limit(1));
  const a = rows[0];
  if (!a) {
    log.debug(`${c.askId} no screenshot attached`);
    return;
  }
  const base: Omit<ScreenshotReading, "via" | "model" | "ms" | "note" | "summary" | "errors" | "added"> = { sha256: a.sha256, bytes: a.bytes, mime: a.mime };
  try {
    if (!flagOn("stepfun_vision", `${c.askId} understanding`)) {
      log.skip(`${c.askId} screenshot ${a.sha256.slice(0, 12)}`, "FEATURE_STEPFUN_VISION was turned off after it was attached; the image is deleted unread");
      c.into.screenshot = { ...base, via: "none", model: "none", ms: 0, note: "Screenshot not read: screenshot reading is turned off.", summary: null, errors: [], added: { services: [], skills: [], artifacts: 0 } };
      return;
    }
    await c.progress("reading your screenshot with StepFun step-5-preview");
    const image = { mime: a.mime, base64: a.dataBase64, sha256: a.sha256, bytes: a.bytes };
    const t0 = performance.now();
    const r = await callModel({ purpose: "read_screenshot", input: { askId: c.askId, image, catalog: c.catalog }, user: c.user, mode: c.mode, askId: c.askId });
    const ms = Math.round(performance.now() - t0);
    if (r.source === "none") {
      log.info(`${c.askId} screenshot ${a.sha256.slice(0, 12)} NOT read (${r.outcome}): demo mode only reads the sample screenshot, and this image has no recorded answer`, { askId: c.askId });
      c.into.screenshot = { ...base, via: "none", model: "none", ms, note: `Screenshot not read: ${r.note.replace(/^No result: /, "")} Demo mode reads only the sample screenshot.`, summary: null, errors: [], added: { services: [], skills: [], artifacts: 0 } };
      await c.progress("could not read the screenshot in demo mode, continuing with your words");
      return;
    }
    const via: ScreenshotReading["via"] = r.source === "live" ? "stepfun" : r.fixture.kind === "recorded" ? "recorded" : "sample";
    const model = r.source === "live" ? r.model : (r.fixture.recorded?.model ?? "step-5-preview");
    const shownMs = r.source === "live" ? r.ms : (r.fixture.recorded?.ms ?? ms);
    log.branch(`${c.askId} screenshot via=${via}`, r.source === "live" ? `step-5-preview answered live in ${r.ms}ms` : `${r.outcome}: ${via === "recorded" ? `recorded live answer hash=${r.fixture.hash}` : "the committed reading of the sample screenshot"}`, { askId: c.askId });
    const out = r.output;
    mergeScreenshot(c.askId, c.into, out, c.catalog, { ...base, via, model, ms: shownMs, note: r.source === "live" ? null : r.note });
    await c.progress(`read the screenshot in ${fmtMs(shownMs)}: ${c.into.screenshot!.errors.length} error(s), ${c.into.screenshot!.added.services.length} more service(s)`);
  } finally {
    // The image is held only until it is read (promise in /privacy).
    await q("ask.attachment.delete", (db) => db.delete(t.askAttachments).where(eq(t.askAttachments.askId, c.askId)));
    log.info(`${c.askId} screenshot ${a.sha256.slice(0, 12)} deleted after reading (${a.bytes} bytes, attached ${a.createdAt.toISOString()})`, { askId: c.askId });
  }
}

/** Union a screenshot reading into the understanding: services, skills, error artifacts. Sensitive text never becomes an artifact. */
export function mergeScreenshot(askId: string, u: Understanding, out: ModelUnderstand, catalog: Catalog, meta: Pick<ScreenshotReading, "sha256" | "bytes" | "mime" | "via" | "model" | "ms" | "note">): void {
  for (const s of out.sensitive) markSensitive(s.text);
  const unsafe = (txt: string) => detectSensitive(txt).length > 0 || out.sensitive.some((s) => txt.includes(s.text));
  const added = addRefs(u, catalog, out.serviceIds, out.skillIds, "screenshot");
  let artifacts = 0;
  for (const art of out.artifacts) {
    if (unsafe(art.text)) {
      log.warn(`${askId} screenshot artifact DROPPED: a ${art.kind} with sensitive text in it (never forwarded)`, { askId });
      continue;
    }
    if (u.artifacts.some((x) => x.text.toLowerCase() === art.text.toLowerCase())) continue;
    u.artifacts.push(art);
    artifacts++;
  }
  const errors = out.artifacts.filter((x) => x.kind === "error" && !unsafe(x.text)).map((x) => x.text);
  u.screenshot = { ...meta, summary: out.restatement, errors, added: { ...added, artifacts } };
  log.info(`${askId} screenshot via=${meta.via} in ${meta.ms}ms: +${added.services.length} service(s) ${added.services.join(", ")}, +${added.skills.length} skill(s), +${artifacts} artifact(s), ${errors.length} error signature(s) ${JSON.stringify(errors)}, ${out.sensitive.length} sensitive span(s) kept out`, { askId });
}

/** Extra words for the similarity search: glossary meanings and what the screenshot showed. */
export function extrasSearchText(u: Understanding): string {
  return [...(u.glossary?.hits.map((h) => `${h.term}: ${h.means}`) ?? []), u.screenshot?.summary ?? "", ...(u.screenshot?.errors ?? [])].filter(Boolean).join("\n");
}
