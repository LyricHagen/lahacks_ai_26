import "server-only";
// Wrap every model call in trackModelCall so model, tokens, latency and estimated cost are logged.

import { AppError } from "./errors";
import { createLogger } from "./log";

const log = createLogger("model");

/** USD per million tokens. Add an entry for every model the app calls. */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  // Cheap model used once to write the fixture text (scripts/generate-fixture.ts). Prompts under 100K tokens.
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  // Local hashed embedding (src/lib/embed.ts): no API call, no cost.
  "w2a-hash-256-v1": { input: 0, output: 0 },
};

export type ModelUsage = { inputTokens: number; outputTokens: number };

export function estimateCostUsd(model: string, usage: ModelUsage): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
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
