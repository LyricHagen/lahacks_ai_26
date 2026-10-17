// pnpm fixture:generate [seed-string] [--no-model]
//
// Builds the company from the seed, has a cheap model (Claude Haiku 5.5) rewrite the free text
// ONCE (bios, project descriptions, non-planted document bodies), embeds everything locally and
// writes fixtures/company.json. Commit that file: `pnpm seed` reads it and never calls a model.
//
// Without ANTHROPIC_API_KEY (or with --no-model) the text stays templated and the script says so
// loudly, in the log and in the fixture's `text` field.
//
// Not rewritten by the model, on purpose: skill evidence (it is shown as a reason and must match
// the structure exactly), planted documents (they are the answers to the scenario questions),
// names, titles and everything structural.

import "./lib/env";
import { createLogger } from "@/lib/log";
import { callModel, type ScriptActor } from "@/lib/model";
import { PLANTED_DOCS } from "@/seed/catalog";
import { type Company, DEFAULT_SEED, FIXTURE_PATH, writeFixture } from "@/seed/fixture";
import { embedCompany, generateCompany, validateCompany } from "@/seed/generate";
import { runScript } from "./lib/run";

const MODEL = "claude-haiku-5-5";
const log = createLogger("fixture");
// Goes through the model gate like every other call: global budget, key check, usage_log row.
const ACTOR: ScriptActor = { kind: "script", name: "fixture-generate" };

/** Seeded data must follow the UI rules too: no em or en dashes, no emoji. */
function clean(text: string): string {
  return text
    .replace(/\s*[—]\s*/g, ", ") // rules-allow (em dash)
    .replace(/[–]/g, "-") // rules-allow (en dash)
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+,/g, ",")
    .trim();
}

type Item = { id: string; facts: string };

async function rewrite(purpose: string, instructions: string, items: Item[]): Promise<Map<string, string>> {
  const system = [
    "You write short, plain text for a synthetic company directory used in a software demo. Every person and company is fictional.",
    "Rules: keep every fact you are given (names, services, repos, commands, numbers). Do not invent new facts about ownership or projects.",
    "Do not use em dashes or en dashes; use commas, colons or parentheses. No emoji. No marketing tone. Avoid pronouns for people; use their first name.",
    'Return only JSON: an array of objects {"id": string, "text": string}, one per input item, same ids.',
  ].join("\n");
  const out = new Map<string, string>();
  const r = await callModel({ purpose: "fixture_text", input: { batch: purpose, system, instructions, items }, user: ACTOR, mode: "live" });
  if (r.source !== "live") {
    log.warn(`${purpose}: ${r.note} Keeping templates for this batch.`, { outcome: r.outcome });
    return out;
  }
  for (const row of r.output) {
    if (row.text.trim().length > 20) out.set(row.id, clean(row.text));
  }
  const missing = items.filter((i) => !out.has(i.id)).map((i) => i.id);
  if (missing.length) log.warn(`${purpose}: ${missing.length} items missing from model output, keeping templates for them`, { missing });
  return out;
}

async function enrichWithModel(c: Company): Promise<{ modelItems: number; templateItems: number }> {
  let modelItems = 0;
  let templateItems = 0;

  const byId = new Map(c.employees.map((e) => [e.id, e]));
  const batches: Item[][] = [];
  for (let i = 0; i < c.employees.length; i += 25) {
    batches.push(c.employees.slice(i, i + 25).map((e) => ({ id: e.id, facts: e.bio })));
  }
  for (const [i, batch] of batches.entries()) {
    const got = await rewrite(
      `fixture.bios.${i + 1}`,
      "Rewrite each directory bio (facts given) as 2 to 4 natural sentences, 50 to 90 words. Keep the title, team, city, tenure, every service name and every quoted claim. Vary sentence shapes between people.",
      batch,
    );
    for (const item of batch) {
      const text = got.get(item.id);
      if (text) {
        byId.get(item.id)!.bio = text;
        modelItems++;
      } else templateItems++;
    }
  }

  const projGot = await rewrite(
    "fixture.projects",
    "Rewrite each project description as 1 or 2 sentences, under 40 words, saying what changed and why it mattered. Keep every service and product name.",
    c.projects.map((p) => ({ id: p.id, facts: `${p.name} (${p.team} team, ${p.status}): ${p.description}` })),
  );
  for (const p of c.projects) {
    const text = projGot.get(p.id);
    if (text) {
      p.description = text;
      modelItems++;
    } else templateItems++;
  }

  const planted = new Set(PLANTED_DOCS.map((d) => d.id));
  const docs = c.documents.filter((d) => !planted.has(d.id));
  for (let i = 0; i < docs.length; i += 8) {
    const batch = docs.slice(i, i + 8);
    const got = await rewrite(
      `fixture.docs.${i / 8 + 1}`,
      "Rewrite each internal document body so it reads like a real, concise engineering or company doc. Keep the paragraph structure (paragraphs separated by a blank line), every command in backticks, every owner name and every number. 120 to 220 words.",
      batch.map((d) => ({ id: d.id, facts: `${d.title}\n\n${d.body}` })),
    );
    for (const d of batch) {
      const text = got.get(d.id);
      if (text) {
        d.body = text;
        modelItems++;
      } else templateItems++;
    }
  }
  templateItems += planted.size;
  return { modelItems, templateItems };
}

await runScript("fixture-generate", async (args) => {
  const seed = args.find((a) => !a.startsWith("--")) ?? DEFAULT_SEED;
  const noModel = args.includes("--no-model");
  const company = generateCompany(seed, log.child("generate"));

  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (noModel || !hasKey) {
    const reason = noModel ? "--no-model was passed" : "ANTHROPIC_API_KEY is not set";
    log.branch("keep templated text", reason);
    log.warn(`TEMPLATED TEXT: ${reason}, so bios, project descriptions and document bodies are templates, not model text. Set ANTHROPIC_API_KEY and rerun pnpm fixture:generate to replace them.`);
    log.warn("TEMPLATED TEXT: the fixture records this in its text.source field, and pnpm seed repeats this warning every time it loads it.");
    company.text = {
      source: "template",
      model: null,
      modelItems: 0,
      templateItems: company.employees.length + company.projects.length + company.documents.length,
      note: `templated because ${reason}`,
    };
  } else {
    log.branch(`rewrite text with ${MODEL}`, "ANTHROPIC_API_KEY is set and --no-model was not passed");
    const { modelItems, templateItems } = await enrichWithModel(company);
    company.text = {
      source: "model",
      model: MODEL,
      modelItems,
      templateItems,
      note: `bios, project descriptions and generic document bodies by ${MODEL}; skill evidence and planted documents are templated on purpose`,
    };
    log.info(`model text for ${modelItems} items, templates for ${templateItems}`);
  }

  embedCompany(company, log.child("embed"));
  const problems = validateCompany(company);
  if (problems.length) {
    log.error(`fixture failed ${problems.length} checks, not writing it`, { problems: problems.slice(0, 20) });
    throw new Error(`fixture invalid: ${problems[0]}`);
  }
  const bytes = await writeFixture(company);
  log.info(`wrote ${FIXTURE_PATH}`, {
    bytes,
    seed,
    text: company.text.source,
    employees: company.employees.length,
    services: company.services.length,
    documents: company.documents.length,
    asks: company.asks.length,
    scenarios: company.scenarios.length,
  });
});
