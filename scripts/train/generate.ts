// pnpm train:generate [--max-usd 1.5] [--limit N] [--concurrency 8]
//
// Writes data/understand/generated.jsonl: one line per accepted example, each a known-correct
// understand_ask label (scripts/train/spec.ts) plus the messy question a frontier model wrote for
// it. Resumable: ids already in the file are skipped, so a crash or the cost cap never loses work.
// Commit the file; regenerating it is never needed to train or evaluate.
//
// Every call goes through callModel (purpose train_phrasing) as the script actor, so the global
// budget, the key check and a usage_log row apply. Spend is summed from the live results and the
// run stops scheduling batches at --max-usd.
//
// Rejections (logged with the reason, counted in data/understand/generation.json): an artifact or
// sensitive text not copied exactly, a service name in a no-vocabulary ask, another service named,
// a link, ticket or repo that is not in the label, a restatement that leaks a sensitive span.

import "../lib/env";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createLogger } from "@/lib/log";
import { callModel, type ScriptActor } from "@/lib/model";
import { resolveScriptMode } from "@/lib/mode";
import { matchServices, type ModelUnderstand } from "@/lib/understanding";
import { runScript } from "../lib/run";
import { buildSpecs, type CatalogService, type CatalogSkill, type Spec } from "./spec";

const log = createLogger("train.generate");
const ACTOR: ScriptActor = { kind: "script", name: "train-generate" };
export const DATA_DIR = "data/understand";
export const GENERATED = `${DATA_DIR}/generated.jsonl`;
export const SEED = "understand-v1";
const BATCH = 10;

export type Example = {
  id: string;
  set: "main" | "holdout";
  category: Spec["category"];
  language: string;
  style: string;
  text: string;
  gold: ModelUnderstand;
};

export function loadCatalog(): { services: CatalogService[]; skills: CatalogSkill[] } {
  const c = JSON.parse(readFileSync("fixtures/company.json", "utf8")) as { services: CatalogService[]; skills: CatalogSkill[] };
  return {
    services: c.services.map(({ id, name, repo, description, team, skillIds }) => ({ id, name, repo, description, team, skillIds })),
    skills: c.skills.map(({ id, name, aliases }) => ({ id, name, aliases })),
  };
}

/** Seeded data follows the UI rules too: no em or en dashes, no emoji. */
export function clean(s: string): string {
  return s
    .replace(/\s*[—]\s*/g, ", ") // rules-allow (em dash)
    .replace(/[–]/g, "-") // rules-allow (en dash)
    .replace(/\p{Extended_Pictographic}|️/gu, "")
    .replace(/[ \t]+,/g, ",")
    .trim();
}

/** What the generator sees: the label, without fields that only matter to the scorer. */
function forPrompt(s: Spec) {
  return {
    id: s.id,
    language: s.language,
    style: s.style,
    namesAllowed: s.namesAllowed,
    services: s.services.map((x) => (s.namesAllowed ? { name: x.name, whatItDoes: x.description } : { whatItDoes: x.description })),
    skills: s.skills.map((k) => k.name),
    artifacts: s.artifacts,
    helpKind: s.helpKind,
    urgency: s.urgency,
    sensitive: s.sensitive.map((x) => (x.text ? { text: x.text, why: x.why } : { topic: x.topic, why: x.why })),
  };
}

type Verdict = { ok: true; example: Example } | { ok: false; reason: string };

export function validate(spec: Spec, out: { text: string; restatement: string; sensitive: Array<{ text: string; why: string }> }, catalog: { services: CatalogService[] }): Verdict {
  const text = clean(out.text);
  const restatement = clean(out.restatement);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 4 || text.length > 1500) return { ok: false, reason: `length ${words} words` };
  for (const a of spec.artifacts) if (!text.includes(a.text)) return { ok: false, reason: `artifact not copied: ${a.text}` };
  const sensitive: Array<{ text: string; why: string }> = [];
  for (const s of spec.sensitive) {
    if (s.text) {
      if (!text.includes(s.text)) return { ok: false, reason: `sensitive text not copied (${s.kind})` };
      sensitive.push({ text: s.text, why: s.why });
    } else {
      const span = out.sensitive.map((x) => clean(x.text)).find((t) => t.length >= 12 && text.includes(t) && !spec.sensitive.some((g) => g.text === t));
      if (!span) return { ok: false, reason: "personal sentence not returned as an exact substring" };
      sensitive.push({ text: span, why: s.why });
    }
  }
  const named = matchServices(text, { services: catalog.services, skills: [] });
  if (!spec.namesAllowed && named.length) return { ok: false, reason: `no_vocab text names ${named.map((n) => n.name).join(", ")}` };
  const extra = named.filter((n) => !spec.services.some((s) => s.id === n.id));
  if (extra.length) return { ok: false, reason: `names another service: ${extra.map((n) => n.name).join(", ")}` };
  const artifacts = [...spec.artifacts] as ModelUnderstand["artifacts"];
  // The repo of a service it names is a repo artifact, as the app's own extractor treats it.
  for (const s of spec.services) if (text.includes(s.repo) && !artifacts.some((a) => a.text === s.repo)) artifacts.push({ kind: "repo", text: s.repo });
  const listed = (t: string) => artifacts.some((a) => a.text.includes(t) || t.includes(a.text)) || sensitive.some((s) => s.text.includes(t));
  for (const m of text.matchAll(/https?:\/\/[^\s)"']+|\b[A-Z][A-Z0-9]{1,9}-\d+\b|\b(?:ferndale|github\.com\/[\w.-]+)\/[\w.-]+/g)) {
    const v = m[0].replace(/[.,;:!?]+$/, "");
    if (!listed(v)) return { ok: false, reason: `unlisted artifact in text: ${v}` };
  }
  if (!/^You\b/.test(restatement) || restatement.length < 8 || restatement.length > 400) return { ok: false, reason: "restatement does not start with You or has a bad length" };
  if (sensitive.some((s) => restatement.includes(s.text))) return { ok: false, reason: "restatement repeats a sensitive span" };
  return {
    ok: true,
    example: {
      id: spec.id,
      set: spec.holdout ? "holdout" : "main",
      category: spec.category,
      language: spec.language,
      style: spec.style,
      text,
      gold: {
        restatement,
        serviceIds: spec.services.map((s) => s.id),
        skillIds: spec.skills.map((k) => k.id),
        artifacts,
        helpKind: spec.helpKind,
        urgency: spec.urgency,
        sensitive,
      },
    },
  };
}

function argValue(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
}

if (process.argv[1]?.endsWith("generate.ts"))
  await runScript("train-generate", async (args) => {
    const maxUsd = argValue(args, "--max-usd", 1.5);
    const limit = argValue(args, "--limit", Infinity);
    const concurrency = argValue(args, "--concurrency", 8);
    const mode = resolveScriptMode("train:generate");
    if (mode.mode !== "live") throw new Error("ANTHROPIC_API_KEY is not set; the committed data/understand/generated.jsonl is all training needs.");
    mkdirSync(DATA_DIR, { recursive: true });
    const catalog = loadCatalog();
    const specs = buildSpecs(SEED, catalog);
    const done = new Set<string>();
    if (existsSync(GENERATED)) for (const line of readFileSync(GENERATED, "utf8").split("\n")) if (line.trim()) done.add((JSON.parse(line) as Example).id);
    const statsPath = `${DATA_DIR}/generation.json`;
    const stats = existsSync(statsPath) ? (JSON.parse(readFileSync(statsPath, "utf8")) as { attempted: number; accepted: number; rejected: Record<string, number>; costUsd: number; calls: number }) : { attempted: 0, accepted: 0, rejected: {}, costUsd: 0, calls: 0 };
    const todo = specs.filter((s) => !done.has(s.id)).slice(0, limit);
    log.info(`${specs.length} specs, ${done.size} already generated, ${todo.length} to do; cap $${maxUsd} this run, ${concurrency} at a time`);
    const batches: Spec[][] = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    let spent = 0;
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        if (spent >= maxUsd) {
          log.skip(`batch ${next + 1} and later`, `spent $${spent.toFixed(4)} reached the cap $${maxUsd}`);
          return;
        }
        const n = next++;
        const batch = batches[n];
        const r = await callModel({ purpose: "train_phrasing", input: { batch: `batch ${n + 1}/${batches.length}`, specs: batch.map(forPrompt) }, user: ACTOR, mode });
        if (r.source !== "live") {
          log.warn(`batch ${n + 1} not generated: ${r.note}`);
          continue;
        }
        spent += r.costUsd ?? 0;
        stats.calls++;
        stats.costUsd += r.costUsd ?? 0;
        for (const spec of batch) {
          stats.attempted++;
          const out = r.output.find((o) => o.id === spec.id);
          const v: Verdict = out ? validate(spec, out, catalog) : { ok: false, reason: "missing from the batch output" };
          if (v.ok) {
            stats.accepted++;
            appendFileSync(GENERATED, `${JSON.stringify(v.example)}\n`);
          } else {
            const key = v.reason.replace(/:.*$/, "");
            stats.rejected[key] = (stats.rejected[key] ?? 0) + 1;
            log.debug(`rejected ${spec.id} (${spec.category}): ${v.reason}`);
          }
        }
        log.info(`batch ${n + 1}/${batches.length} done: ${stats.accepted} accepted of ${stats.attempted} so far, $${spent.toFixed(4)} this run`);
        writeFileSync(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    writeFileSync(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
    log.info(`generation finished: ${stats.accepted} accepted of ${stats.attempted} attempted, $${stats.costUsd.toFixed(4)} total, rejections ${JSON.stringify(stats.rejected)}`);
  });
