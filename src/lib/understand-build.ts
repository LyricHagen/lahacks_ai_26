import "server-only";
// Request-free helpers for understanding an ask: the catalog, the text a model may read, and
// turning a model-shaped answer into the stored Understanding. No next/* imports (directly or via
// auth), so scripts like pnpm retrieve:check can use them.

import { q } from "@/db";
import * as t from "@/db/schema";
import { EMBEDDING_MODEL } from "./embed";
import { createLogger, markSensitive } from "./log";
import { type Catalog, type ModelUnderstand, matchServices, matchSkills, type NamedRef, type ParseInfo, type Understanding, type UnderstandVia } from "./understanding";

const log = createLogger("ask.understand");

export async function loadCatalog(): Promise<Catalog> {
  const [services, skills] = await Promise.all([
    q("ask.catalog.services", (db) => db.select({ id: t.services.id, name: t.services.name, repo: t.services.repo, description: t.services.description, embedding: t.services.embedding }).from(t.services).orderBy(t.services.name)),
    q("ask.catalog.skills", (db) => db.select({ id: t.skills.id, name: t.skills.name, aliases: t.skills.aliases }).from(t.skills).orderBy(t.skills.name)),
  ]);
  return { services, skills };
}

/** Keep sensitive spans out of every later line of this request (SQL trace included). */
export function protectUnderstanding(u: Understanding | null): void {
  for (const s of u?.sensitive ?? []) markSensitive(s.text);
}

/** The text the understanding reads: the ask and what was tried. Never the confidential note. */
export function askText(ask: { body: string; tried: string | null }): string {
  return [ask.body, ask.tried ?? ""].join("\n").trim();
}

/** Turn ids from the model (or a fixture) into named refs; unknown ids are dropped and logged. */
function resolveIds(label: string, kind: string, ids: string[], all: Array<{ id: string; name: string }>, matched: string): NamedRef[] {
  const out: NamedRef[] = [];
  for (const id of [...new Set(ids)]) {
    const hit = all.find((x) => x.id === id);
    if (hit) out.push({ id, name: hit.name, matched });
    else log.warn(`${label} dropped unknown ${kind} id "${id}" from the ${matched} answer`);
  }
  return out;
}

/** Build the stored understanding from a model-shaped answer, adding keyword facts the answer missed. */
export function buildUnderstanding(args: {
  label: string;
  text: string;
  catalog: Catalog;
  output: ModelUnderstand;
  via: UnderstandVia;
  note: string | null;
  askUrgency: string;
  parse?: ParseInfo;
}): Understanding {
  const { label, text, catalog, output, via } = args;
  const services = resolveIds(label, "service", output.serviceIds, catalog.services, via);
  const skills = resolveIds(label, "skill", output.skillIds, catalog.skills, via);
  if (via !== "keywords") {
    // Names the user typed are facts; never let a model or fixture lose them.
    const addS = matchServices(text, catalog).filter((k) => !services.some((s) => s.id === k.id));
    const addK = matchSkills(text, catalog).filter((k) => !skills.some((s) => s.id === k.id));
    if (addS.length || addK.length) log.branch(`${label} add keyword hits to the ${via} answer`, `named in the text but missing: ${[...addS, ...addK].map((x) => x.id).join(", ")}`);
    services.push(...addS);
    skills.push(...addK);
  }
  const sensitive = output.sensitive.filter((s) => {
    const inText = text.includes(s.text);
    if (!inText) log.warn(`${label} dropped a sensitive span that is not in the ask text (why: ${s.why})`);
    return inText;
  });
  for (const s of sensitive) markSensitive(s.text);
  // The composer's urgency field defaults to blocked_today; a different value was chosen on purpose.
  const userChose = args.askUrgency !== "blocked_today";
  const urgency = userChose ? (args.askUrgency as Understanding["urgency"]) : (output.urgency ?? "blocked_today");
  log.branch(`${label} urgency ${urgency}`, userChose ? "the asker chose it in the composer" : output.urgency ? `read from the text by ${via}` : "not stated anywhere, so the default");
  return {
    version: 2,
    via,
    note: args.note,
    restatement: output.restatement,
    services,
    skills,
    artifacts: output.artifacts,
    helpKind: output.helpKind,
    urgency,
    sensitive,
    words: text.split(/\s+/).filter(Boolean).length,
    embeddingModel: EMBEDDING_MODEL,
    editedByUser: false,
    edits: [],
    ...(args.parse ? { parse: args.parse } : {}),
  };
}
