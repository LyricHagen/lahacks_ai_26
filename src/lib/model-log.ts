import "server-only";
// Wrap every model call in trackModelCall so model, tokens, latency and estimated cost are logged.

import { AppError } from "./errors";
import { createLogger } from "./log";

const log = createLogger("model");

/**
 * USD per million tokens, or per GPU hour for a model we serve ourselves (the call is priced at the
 * GPU time it held at concurrency 1, an upper bound: a busy fleet batches many calls into that
 * time). Add an entry for every model the app calls.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number; gpuUsdPerHour?: number }> = {
  // Cheap model used once to write the fixture text (scripts/generate-fixture.ts). Prompts under 100K tokens.
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  // Local hashed embedding (src/lib/embed.ts): no API call, no cost.
  "w2a-hash-256-v1": { input: 0, output: 0 },
  // Frontier baseline in the understand_ask eval (scripts/train/eval.ts).
  "claude-sonnet-5-5": { input: 2, output: 10 },
  // Our fine-tune and its base on Veri, priced by GPU hour (scripts/train/README.md). The adapter
  // alias is served from the A10G fleet ($1.31/h); the base model answers to the fleet's name.
  "altostratus-understand": { input: 0, output: 0, gpuUsdPerHour: 1.31 },
  "altostratus-understand-a10g": { input: 0, output: 0, gpuUsdPerHour: 1.31 },
  // The first fleet, on an L4 ($1.05/h), kept for the eval's L4 row.
  "who2ask-understand": { input: 0, output: 0, gpuUsdPerHour: 1.05 },
  "Qwen/Qwen2.5-1.5B-Instruct": { input: 0, output: 0, gpuUsdPerHour: 1.05 },
  // StepFun step-5-preview, which reads screenshots (read_screenshot). USD list price as published by
  // resellers in October 2026 (StepFun bills natively in yuan: 7 in, 20 out per million).
  "step-5-preview": { input: 1, output: 2.7 },
  // The CREAO glossary agent (resolve_jargon). CREAO bills runs in its own credits, not tokens, so
  // the usage row records 0 USD and the run id plus credits (when reported) go in tier_note.
  "creao-glossary-agent": { input: 0, output: 0 },
};

export type ModelUsage = { inputTokens: number; outputTokens: number };

export function estimateCostUsd(model: string, usage: ModelUsage, ms?: number): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  if (p.gpuUsdPerHour !== undefined) return ((ms ?? 0) / 3_600_000) * p.gpuUsdPerHour;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}

export async function trackModelCall<T>(
  purpose: string,
  model: string,
  call: () => Promise<{ result: T; usage: ModelUsage }>,
): Promise<T> {
  const t0 = performance.now();
  log.info(`call ${purpose} start`, { model });
  try {
    const { result, usage } = await call();
    const ms = Math.round(performance.now() - t0);
    const cost = estimateCostUsd(model, usage);
    if (cost === null) log.warn(`no price for ${model} in MODEL_PRICES, cost not estimated`);
    log.info(`call ${purpose} done in ${ms}ms`, {
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ms,
      costUsd: cost === null ? null : Number(cost.toFixed(6)),
    });
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    log.error(`call ${purpose} failed after ${ms}ms`, { model, ms, err });
    throw new AppError("MODEL_CALL_FAILED", undefined, { status: 502, cause: err, context: { model, purpose } });
  }
}
