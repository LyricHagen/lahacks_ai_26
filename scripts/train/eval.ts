// pnpm train:eval [--systems keywords,haiku,sonnet,base,finetune] [--sets test,heldout] [--max-usd 2.5] [--limit N] [--report-only]
//
// Runs each system on the 300-example test set and the held-out-services set, scores it
// (scripts/train/score.ts) and writes:
//   data/understand/eval/<system>.jsonl   one prediction per example (resumable: done ids are skipped)
//   data/understand/eval/results.json     the summary /admin/models renders
//   scripts/train/EVAL.md                 the committed table
//
// Systems, every model call through callModel with the tier forced (so the gate, logging and a
// usage_log row apply):
//   keywords  the deterministic extractor (src/lib/understanding.ts), the floor; no call
//   haiku     claude-haiku-5-5 with the production prompt (the app's frontier tier today)
//   sonnet    claude-sonnet-5-5 with the same prompt (the frontier baseline)
//   base      Qwen2.5-1.5B-Instruct on Veri, untuned, with the full rules prompt
//   finetune  the same model with our LoRA adapter, compact prompt
// Veri systems run one call at a time so latency is what one user sees; Anthropic runs 4 at a time.

import "../lib/env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { wallNow } from "@/lib/clock";
import { createLogger } from "@/lib/log";
import { callModel, type ScriptActor, type TierName } from "@/lib/model";
import { MODEL_PRICES } from "@/lib/model-log";
import { resolveScriptMode } from "@/lib/mode";
import { UNDERSTAND_PROMPT_VERSION } from "@/lib/understand-compact";
import { type Catalog, extractByKeywords, type ModelUnderstand } from "@/lib/understanding";
import { runScript } from "../lib/run";
import { DATA_DIR, type Example } from "./generate";
import { promptCatalog, readJsonl, SPLITS } from "./prep";
import { percentile, scoreExample, type Summary, summarize } from "./score";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "./spec";

const log = createLogger("train.eval");
const ACTOR: ScriptActor = { kind: "script", name: "train-eval" };
const EVAL_DIR = `${DATA_DIR}/eval`;
export const RESULTS = `${EVAL_DIR}/results.json`;

export const SYSTEMS = ["keywords", "haiku", "sonnet", "base", "finetune", "finetune_l4"] as const;
export type SystemName = (typeof SYSTEMS)[number];
const TIER: Record<Exclude<SystemName, "keywords">, TierName> = { haiku: "frontier", sonnet: "sonnet", base: "base", finetune: "finetune", finetune_l4: "finetune" };
/** Run only when named: the same adapter on the cheaper L4 fleet (point VERI_UNDERSTAND_DEPLOYMENT at it). */
const DEFAULT_SYSTEMS = SYSTEMS.filter((s) => s !== "finetune_l4");
export const SYSTEM_LABEL: Record<SystemName, string> = {
  keywords: "Keyword fallback (floor)",
  haiku: "Claude Haiku 5.5, prompted (production today)",
  sonnet: "Claude Sonnet 5.5, prompted (frontier)",
  base: "Qwen2.5 1.5B Instruct, prompted (base)",
  finetune: "Qwen2.5 1.5B + LoRA (our fine-tune)",
  finetune_l4: "Same fine-tune on a cheaper L4 GPU",
};

type Pred = { id: string; set: "main" | "holdout"; category: Category; valid: boolean; ms: number; costUsd: number; inputTokens: number; outputTokens: number; model: string; pred: ModelUnderstand | null; error: string | null };

export type SystemResult = {
  system: SystemName;
  label: string;
  model: string;
  test: Summary & { p50: number; p95: number; costPer1k: number };
  byCategory: Record<Category, { n: number; entityF1: number; validity: number; sensitiveRecall: number }>;
  heldout: Summary | null;
};
export type EvalResults = { generatedAt: string; promptVersion: string; testN: number; heldoutN: number; systems: SystemResult[]; notes: string[] };

function arg(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

function keywordCatalog(): Catalog {
  const c = JSON.parse(readFileSync("fixtures/company.json", "utf8")) as { services: Array<{ id: string; name: string; repo: string; description: string; embedding: number[] }> };
  const p = promptCatalog();
  return { services: p.services.map((s) => ({ ...s, embedding: c.services.find((x) => x.id === s.id)?.embedding ?? null })), skills: p.skills };
}

/** A gate refusal (budget, mode, key) says nothing about the system, so it stops the run instead of scoring as invalid. */
class GateRefused extends Error {}

async function predictOne(system: SystemName, e: Example, mode: ReturnType<typeof resolveScriptMode>, kwCatalog: Catalog, catalog: Catalog): Promise<Pred> {
  const base = { id: e.id, set: e.set, category: e.category };
  if (system === "keywords") {
    const t0 = performance.now();
    const out = extractByKeywords(e.text, kwCatalog).output;
    return { ...base, valid: true, ms: Math.max(1, Math.round(performance.now() - t0)), costUsd: 0, inputTokens: 0, outputTokens: 0, model: "keywords", pred: out, error: null };
  }
  const r = await callModel({ purpose: "understand_ask", input: { askId: e.id, text: e.text, catalog }, user: ACTOR, mode, tier: TIER[system] });
  if (r.source === "live") return { ...base, valid: true, ms: r.ms, costUsd: r.costUsd ?? 0, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, model: r.model, pred: r.output, error: null };
  if (r.outcome !== "provider_error") throw new GateRefused(`${system} ${e.id}: the gate refused the call (${r.outcome}): ${r.note}`);
  return { ...base, valid: false, ms: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, model: TIER[system], pred: null, error: r.note };
}

function summarizeSystem(system: SystemName, preds: Pred[], gold: Map<string, Example>): SystemResult | null {
  const test = preds.filter((p) => p.set === "main");
  if (!test.length) return null;
  const score = (ps: Pred[]) => ps.map((p) => scoreExample(gold.get(p.id)!.gold, p.pred));
  const live = test.filter((p) => p.valid && p.ms > 0).map((p) => p.ms);
  const s = summarize(score(test));
  const held = preds.filter((p) => p.set === "holdout");
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => {
      const ps = test.filter((p) => p.category === c);
      const sum = summarize(score(ps));
      return [c, { n: ps.length, entityF1: sum.entityF1, validity: sum.validity, sensitiveRecall: sum.sensitiveRecall }];
    }),
  ) as SystemResult["byCategory"];
  const costs = test.filter((p) => p.valid).map((p) => p.costUsd);
  return {
    system,
    label: SYSTEM_LABEL[system],
    model: test.find((p) => p.valid)?.model ?? "",
    test: { ...s, p50: percentile(live, 50), p95: percentile(live, 95), costPer1k: costs.length ? (costs.reduce((a, b) => a + b, 0) / costs.length) * 1000 : 0 },
    byCategory,
    heldout: held.length ? summarize(score(held)) : null,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)}s` : `${Math.round(x)}ms`);
const usd = (x: number) => (x === 0 ? "$0" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);

export function renderMarkdown(r: EvalResults): string {
  const rows = r.systems;
  const lines = [
    "# understand_ask eval",
    "",
    `Generated by \`pnpm train:eval\` at ${r.generatedAt}. Prompt version \`${r.promptVersion}\`. Test set: ${r.testN} held-out examples, 50 per category. Held-out services: ${r.heldoutN} examples about services no training example mentions. Data and method: \`scripts/train/README.md\`; model card: \`scripts/train/MODEL_CARD.md\`.`,
    "",
    "## Headline (test set)",
    "",
    "| System | Schema valid | Entity F1 | Services F1 | Skills F1 | Artifacts F1 | Sensitive recall | Help kind | Urgency | p50 | p95 | Cost / 1k calls |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((s) => `| ${s.label} | ${pct(s.test.validity)} | ${pct(s.test.entityF1)} | ${pct(s.test.fieldF1.services)} | ${pct(s.test.fieldF1.skills)} | ${pct(s.test.fieldF1.artifacts)} | ${pct(s.test.sensitiveRecall)} | ${pct(s.test.helpKindAcc)} | ${pct(s.test.urgencyAcc)} | ${ms(s.test.p50)} | ${ms(s.test.p95)} | ${usd(s.test.costPer1k)} |`),
    "",
    "## Entity F1 by category (test set)",
    "",
    `| System | ${CATEGORIES.map((c) => CATEGORY_LABEL[c]).join(" | ")} |`,
    `|---|${CATEGORIES.map(() => "---").join("|")}|`,
    ...rows.map((s) => `| ${s.label} | ${CATEGORIES.map((c) => pct(s.byCategory[c].entityF1)).join(" | ")} |`),
    "",
    "## Held-out services (generalization)",
    "",
    "| System | Schema valid | Entity F1 | Services F1 | Sensitive recall |",
    "|---|---|---|---|---|",
    ...rows.filter((s) => s.heldout).map((s) => `| ${s.label} | ${pct(s.heldout!.validity)} | ${pct(s.heldout!.entityF1)} | ${pct(s.heldout!.fieldF1.services)} | ${pct(s.heldout!.sensitiveRecall)} |`),
    "",
    "## How to read this",
    "",
    ...r.notes.map((n) => `- ${n}`),
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("eval.ts"))
  await runScript("train-eval", async (args) => {
    const systems = (arg(args, "--systems")?.split(",") ?? [...DEFAULT_SYSTEMS]) as SystemName[];
    const sets = arg(args, "--sets")?.split(",") ?? ["test", "heldout"];
    const maxUsd = Number(arg(args, "--max-usd") ?? 2.5);
    const limit = Number(arg(args, "--limit") ?? Infinity);
    const reportOnly = args.includes("--report-only");
    mkdirSync(EVAL_DIR, { recursive: true });
    const test = readJsonl<Example>(SPLITS.test);
    const heldout = readJsonl<Example>(SPLITS.heldout);
    const gold = new Map([...test, ...heldout].map((e) => [e.id, e]));
    const mode = resolveScriptMode("train:eval");
    const catalog = promptCatalog();
    const kwCatalog = keywordCatalog();
    let spent = 0;

    if (!reportOnly)
      for (const system of systems) {
        const path = `${EVAL_DIR}/${system}.jsonl`;
        const done = new Set(existsSync(path) ? readJsonl<Pred>(path).map((p) => p.id) : []);
        const todo = [...(sets.includes("test") ? test : []), ...(sets.includes("heldout") ? heldout : [])].filter((e) => !done.has(e.id)).slice(0, limit);
        log.info(`${system}: ${done.size} done, ${todo.length} to run`);
        const concurrency = system === "keywords" || system === "base" || system === "finetune" || system === "finetune_l4" ? 1 : 4;
        let next = 0;
        let failures = 0;
        const worker = async () => {
          while (next < todo.length) {
            if (spent >= maxUsd) return log.skip(`${system} remaining examples`, `spent $${spent.toFixed(3)} reached --max-usd ${maxUsd}`);
            const e = todo[next++];
            let p: Pred;
            try {
              p = await predictOne(system, e, mode, kwCatalog, catalog);
            } catch (err) {
              if (!(err instanceof GateRefused)) throw err;
              next = todo.length;
              return log.error(`${system}: stopped, nothing written for the rest: ${err.message}`);
            }
            spent += p.costUsd;
            if (!p.valid) failures++;
            writeFileSync(path, `${JSON.stringify(p)}\n`, { flag: "a" });
            if (next % 25 === 0) log.info(`${system}: ${next}/${todo.length}, ${failures} invalid, $${spent.toFixed(3)} spent this run`);
          }
        };
        await Promise.all(Array.from({ length: concurrency }, worker));
        log.info(`${system}: finished, ${failures} invalid of ${todo.length}`);
      }

    const results: SystemResult[] = [];
    for (const system of SYSTEMS) {
      const path = `${EVAL_DIR}/${system}.jsonl`;
      if (!existsSync(path)) continue;
      const r = summarizeSystem(system, readJsonl<Pred>(path), gold);
      if (r) results.push(r);
    }
    const veriRate = MODEL_PRICES["altostratus-understand"]?.gpuUsdPerHour ?? 0;
    const l4Rate = MODEL_PRICES["who2ask-understand"]?.gpuUsdPerHour ?? 0;
    const out: EvalResults = {
      generatedAt: wallNow().toISOString(),
      promptVersion: UNDERSTAND_PROMPT_VERSION,
      testN: test.length,
      heldoutN: heldout.length,
      systems: results,
      notes: [
        "Schema valid: the output parsed as JSON and passed the same Zod schema the app enforces (ModelUnderstandSchema). Invalid outputs score as empty.",
        "Entity F1: micro F1 over services, skills, artifacts and sensitive spans. Ids must match exactly; artifact and sensitive texts match when one contains the other after normalizing case and quotes. Artifacts of kind \"other\" are ignored on both sides.",
        "Sensitive recall: share of gold sensitive spans (credentials, contact details, personal and HR sentences, customer data) the system flagged for exclusion.",
        "Latency: wall time of one call as the app makes it, measured from this machine. Anthropic calls ran 4 at a time; Veri calls one at a time on one warm GPU: an A10G for the base and fine-tune rows, an L4 for the L4 row. Decoding is memory-bandwidth bound, so the GPU sets most of the fine-tune's latency; about 0.2 to 0.3s of every Veri call is the gateway.",
        `Cost: Anthropic list prices with prompt caching on the catalog prefix. Veri cost is GPU time held by the call at concurrency 1 ($${veriRate} per A10G hour, $${l4Rate} per L4 hour), an upper bound: a busy fleet batches calls, and an idle one costs nothing after it scales to zero.`,
        "The test set is synthetic, written by Claude Haiku 5.5 from known labels (scripts/train/spec.ts), so the frontier models are reading text from a model of their own family. That favours them, if anything.",
      ],
    };
    writeFileSync(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
    writeFileSync("scripts/train/EVAL.md", renderMarkdown(out));
    for (const s of results) log.info(`${s.system}: valid ${pct(s.test.validity)} entityF1 ${pct(s.test.entityF1)} sensitive ${pct(s.test.sensitiveRecall)} p50 ${ms(s.test.p50)} p95 ${ms(s.test.p95)} per1k ${usd(s.test.costPer1k)}${s.heldout ? ` heldout F1 ${pct(s.heldout.entityF1)}` : ""}`);
  });
