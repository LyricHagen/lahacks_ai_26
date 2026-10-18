import "server-only";
// The Veri provider: the OpenAI-compatible chat endpoint of a Veri deployment (api.veri.studio)
// serving our fine-tuned understand_ask adapter on its base model. Called ONLY from callModel
// (src/lib/model.ts), which owns the gate, the tier chain, logging and the usage row; nothing else
// may import this module.
//
//   VERI_API_KEY                 Bearer key (vk_...)
//   VERI_UNDERSTAND_DEPLOYMENT   deployment id of the multi-adapter fleet
//   VERI_UNDERSTAND_MODEL        adapter alias on that fleet (default altostratus-understand)
//   VERI_BASE_MODEL              the fleet's base model name, for the eval's "base prompted" row
//   VERI_TIMEOUT_MS              fine-tune tier timeout before falling to the frontier (default 2500)

import { AppError } from "./errors";

const API = process.env.VERI_API_URL ?? "https://api.veri.studio";

export type VeriConfig = { deploymentId: string; model: string };

export const VERI_DEFAULTS = {
  model: "altostratus-understand",
  baseModel: "Qwen/Qwen2.5-1.5B-Instruct",
  timeoutMs: 2500,
};

/** Why the fine-tune tier cannot run, or null when it can. */
export function veriUnavailable(): string | null {
  if (!process.env.VERI_API_KEY) return "VERI_API_KEY is not set";
  if (!process.env.VERI_UNDERSTAND_DEPLOYMENT) return "VERI_UNDERSTAND_DEPLOYMENT is not set";
  return null;
}

export function veriConfig(kind: "finetune" | "base"): VeriConfig | null {
  if (veriUnavailable()) return null;
  return {
    deploymentId: process.env.VERI_UNDERSTAND_DEPLOYMENT!,
    model: kind === "finetune" ? (process.env.VERI_UNDERSTAND_MODEL ?? VERI_DEFAULTS.model) : (process.env.VERI_BASE_MODEL ?? VERI_DEFAULTS.baseModel),
  };
}

export function veriTimeoutMs(): number {
  const n = Number(process.env.VERI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : VERI_DEFAULTS.timeoutMs;
}

export async function veriChat(args: {
  config: VeriConfig;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  timeoutMs: number;
}): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
  let res: Response;
  try {
    res = await fetch(`${API}/v1/deployments/${args.config.deploymentId}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.VERI_API_KEY}`, "content-type": "application/json", "x-veri-agent": "altostratus" },
      body: JSON.stringify({ model: args.config.model, messages: args.messages, max_tokens: args.maxTokens, temperature: 0 }),
      signal: AbortSignal.timeout(args.timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AppError(timedOut ? "MODEL_TIER_TIMEOUT" : "MODEL_TIER_FAILED", timedOut ? `no answer within ${args.timeoutMs}ms` : `request failed: ${(err as Error).message}`, { cause: err });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 503 deployment_waking: the fleet scaled to zero and is booting; the request itself wakes it.
    throw new AppError("MODEL_TIER_FAILED", `veri answered ${res.status}${res.headers.get("retry-after") ? ` (retry after ${res.headers.get("retry-after")}s)` : ""}: ${body.slice(0, 200)}`, { context: { status: res.status } });
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new AppError("MODEL_TIER_FAILED", "veri answered with no text");
  return { text, usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 } };
}
