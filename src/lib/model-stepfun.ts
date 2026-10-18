import "server-only";
// The StepFun provider: step-5-preview on StepFun's OpenAI-compatible chat endpoint, used for its
// image understanding (the read_screenshot purpose). Called ONLY from callModel (src/lib/model.ts),
// which owns the gate, logging and the usage row; nothing else may import this module.
//
//   STEPFUN_API_KEY      Bearer key
//   STEPFUN_API_URL      default https://api.stepfun.ai/v1
//   STEPFUN_MODEL        default step-5-preview
//   STEPFUN_TIMEOUT_MS   per attempt, default 45000 (a reasoning model reading a dense screenshot)
//
// One retry, after 800ms, on a network error, 408, 429 or 5xx. Every attempt is logged with its
// status and time; the image itself is never logged (only its size and hash, by the caller).

import { AppError } from "./errors";
import { createLogger } from "./log";

const log = createLogger("model.stepfun");

export const STEPFUN_DEFAULTS = { url: "https://api.stepfun.ai/v1", model: "step-5-preview", timeoutMs: 45_000 };

export function stepfunModel(): string {
  return process.env.STEPFUN_MODEL || STEPFUN_DEFAULTS.model;
}

export function stepfunTimeoutMs(): number {
  const n = Number(process.env.STEPFUN_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : STEPFUN_DEFAULTS.timeoutMs;
}

type ChatResponse = {
  id?: string;
  choices?: Array<{ finish_reason?: string; message?: { content?: string; reasoning?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number };
};

export async function stepfunChat(args: {
  model: string;
  system: string;
  prompt: string;
  images: Array<{ mime: string; base64: string }>;
  maxTokens: number;
  timeoutMs: number;
  effort?: "low" | "medium" | "high";
}): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
  const url = `${process.env.STEPFUN_API_URL || STEPFUN_DEFAULTS.url}/chat/completions`;
  const body = JSON.stringify({
    model: args.model,
    messages: [
      { role: "system", content: args.system },
      {
        role: "user",
        content: [{ type: "text", text: args.prompt }, ...args.images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.base64}`, detail: "high" } }))],
      },
    ],
    max_tokens: args.maxTokens,
    temperature: 0.1,
    response_format: { type: "json_object" },
    ...(args.effort ? { reasoning_effort: args.effort } : {}),
  });
  const imageBytes = args.images.reduce((n, im) => n + Math.floor((im.base64.length * 3) / 4), 0);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = performance.now();
    log.info(`POST ${url} model=${args.model} attempt ${attempt}/2: ${args.images.length} image(s), ${imageBytes} bytes, prompt ${args.prompt.length} chars, max_tokens ${args.maxTokens}, effort ${args.effort ?? "default"}, timeout ${args.timeoutMs}ms`);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.STEPFUN_API_KEY}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(args.timeoutMs),
      });
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      log.warn(`attempt ${attempt}/2 ${timedOut ? `timed out after ${ms}ms` : `network error after ${ms}ms: ${(err as Error).message}`}`, { err });
      if (attempt === 1 && !timedOut) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      throw new AppError(timedOut ? "MODEL_TIER_TIMEOUT" : "MODEL_CALL_FAILED", timedOut ? `step-5-preview gave no answer within ${args.timeoutMs}ms` : `request failed: ${(err as Error).message}`, { cause: err });
    }
    const ms = Math.round(performance.now() - t0);
    const reqId = res.headers.get("x-request-id") ?? res.headers.get("x-stepfun-request-id") ?? "none";
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      log.warn(`attempt ${attempt}/2 answered ${res.status} in ${ms}ms (provider request ${reqId})${retryable && attempt === 1 ? ", retrying once" : ""}: ${text.slice(0, 300)}`);
      if (retryable && attempt === 1) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      throw new AppError("MODEL_CALL_FAILED", `stepfun answered ${res.status}: ${text.slice(0, 200)}`, { context: { status: res.status, providerReqId: reqId } });
    }
    const json = (await res.json()) as ChatResponse;
    const choice = json.choices?.[0];
    const text = choice?.message?.content ?? "";
    const usage = { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 };
    log.info(`answered 200 in ${ms}ms (provider request ${reqId}, id ${json.id ?? "none"}): finish ${choice?.finish_reason ?? "?"}, ${text.length} chars of content, ${choice?.message?.reasoning?.length ?? 0} chars of reasoning, tokens in ${usage.inputTokens} out ${usage.outputTokens}${json.usage?.cached_tokens ? ` (cached ${json.usage.cached_tokens})` : ""}`);
    if (!text) throw new AppError("MODEL_CALL_FAILED", `step-5-preview answered with no content (finish ${choice?.finish_reason ?? "?"})`);
    return { text, usage };
  }
  throw new AppError("MODEL_CALL_FAILED", "step-5-preview: no attempt left");
}
