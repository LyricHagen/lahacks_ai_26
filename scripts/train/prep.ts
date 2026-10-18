// pnpm train:prep
//
// Splits data/understand/generated.jsonl (committed) into:
//   test.jsonl              300 examples, 50 per category, never trained on
//   heldout_services.jsonl  every example about a held-out service (spec.ts HOLDOUT_SERVICES), eval only
//   train.jsonl             everything else
//   veri_train.jsonl        train.jsonl as Veri SFT rows in prompt-completion form: the prompt is the
//                           exact compact prompt the app sends (src/lib/understand-compact.ts), the
//                           completion is the gold JSON, so loss is on the answer only
// Deterministic: same input file, same split. Prints the counts per category and language.

import "../lib/env";
import { readFileSync, writeFileSync } from "node:fs";
import { createLogger } from "@/lib/log";
import { compactMessages } from "@/lib/understand-compact";
import type { Catalog } from "@/lib/understanding";
import { runScript } from "../lib/run";
import { DATA_DIR, type Example, GENERATED, loadCatalog } from "./generate";
import { CATEGORIES, PLAN, rng } from "./spec";

const log = createLogger("train.prep");

export const SPLITS = {
  train: `${DATA_DIR}/train.jsonl`,
  test: `${DATA_DIR}/test.jsonl`,
  heldout: `${DATA_DIR}/heldout_services.jsonl`,
  veri: `${DATA_DIR}/veri_train.jsonl`,
};

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

const writeJsonl = (path: string, rows: unknown[]) => writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

/** The catalog the app loads from the database, built from the committed company fixture. */
export function promptCatalog(): Catalog {
  const c = loadCatalog();
  return { services: c.services.map(({ id, name, repo, description }) => ({ id, name, repo, description })), skills: c.skills };
}

/** The gold answer exactly as the model should write it: fixed key order, compact. */
export function goldJson(e: Example): string {
  const g = e.gold;
  return JSON.stringify({ restatement: g.restatement, serviceIds: g.serviceIds, skillIds: g.skillIds, artifacts: g.artifacts, helpKind: g.helpKind, urgency: g.urgency, sensitive: g.sensitive });
}

if (process.argv[1]?.endsWith("prep.ts"))
  await runScript("train-prep", async () => {
    const all = readJsonl<Example>(GENERATED);
    const main = all.filter((e) => e.set === "main");
    const heldout = all.filter((e) => e.set === "holdout");
    const r = rng("understand-split-v1");
    const shuffled = main.map((e) => ({ e, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.e);
    const test: Example[] = [];
    for (const c of CATEGORIES) {
      const of = shuffled.filter((e) => e.category === c).slice(0, PLAN.testPerCategory);
      if (of.length < PLAN.testPerCategory) log.warn(`only ${of.length} test examples for ${c} (want ${PLAN.testPerCategory})`);
      test.push(...of);
    }
    const testIds = new Set(test.map((e) => e.id));
    const train = shuffled.filter((e) => !testIds.has(e.id));
    const catalog = promptCatalog();
    const veri = train.map((e) => {
      const [system, user] = compactMessages(e.text, catalog);
      return { prompt: [system, user], completion: [{ role: "assistant", content: goldJson(e) }] };
    });
    writeJsonl(SPLITS.train, train);
    writeJsonl(SPLITS.test, test);
    writeJsonl(SPLITS.heldout, heldout);
    writeJsonl(SPLITS.veri, veri);
    const count = (xs: Example[], k: (e: Example) => string) => Object.fromEntries([...new Set(xs.map(k))].sort().map((v) => [v, xs.filter((e) => k(e) === v).length]));
    log.info(`split: ${train.length} train, ${test.length} test, ${heldout.length} held-out services (of ${all.length})`);
    log.info(`train by category ${JSON.stringify(count(train, (e) => e.category))}`);
    log.info(`test by category ${JSON.stringify(count(test, (e) => e.category))}`);
    log.info(`held-out by category ${JSON.stringify(count(heldout, (e) => e.category))}`);
    log.info(`train by language ${JSON.stringify(count(train, (e) => e.language))}`);
    const leak = train.filter((e) => e.gold.serviceIds.some((id) => heldout.some((h) => h.gold.serviceIds[0] === id)));
    if (leak.length) log.warn(`${leak.length} train examples name a held-out service as a second service (two_problems)`);
    else log.info("no train example is about a held-out service");
  });
