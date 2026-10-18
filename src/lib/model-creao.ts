import "server-only";
// The CREAO provider: one saved agent on agent.creao.ai (the glossary agent, agents/creao/), run
// through its app-scoped API Trigger. Called ONLY from callModel (src/lib/model.ts), which owns the
// gate, logging and the usage row; nothing else may import this module.
//
//   CREAO_API_KEY        capi_... key from the agent's page on agent.creao.ai
//   CREAO_APP_ID         the agent's app id (the {appId} in its API Trigger URL)
//   CREAO_API_URL        default https://agent.creao.ai/api/v1
//   CREAO_TIMEOUT_MS     whole run, start to result, default 30000
//
// A run is asynchronous: POST .../runs answers {id, status: pending}; we poll GET .../runs/{id}
// every CREAO_POLL_MS (default 1000) until completed, failed or cancelled. The start is retried
// once on a network error, 429 or 5xx; a poll may fail transiently up to 3 times in a row. Every
// request is logged with the run id and status, so grep "creao run" follows one run.

import { AppError } from "./errors";
import { createLogger } from "./log";

const log = createLogger("model.creao");

export const CREAO_DEFAULTS = { url: "https://agent.creao.ai/api/v1", timeoutMs: 30_000, pollMs: 1000 };
/** The name the usage log and MODEL_PRICES know the agent by. */
export const CREAO_MODEL = "creao-glossary-agent";

export function creaoTimeoutMs(): number {
  const n = Number(process.env.CREAO_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : CREAO_DEFAULTS.timeoutMs;
}

type RunBody = {
  id?: string;
  status?: string;
  errorCode?: string;
  result?: { text?: string; chatText?: string; artifacts?: unknown[] };
  usage?: { credits?: number };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: "GET" | "POST", path: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: RunBody; text: string }> {
  const res = await fetch(`${process.env.CREAO_API_URL || CREAO_DEFAULTS.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.CREAO_API_KEY}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
  });
  const text = await res.text();
  let json: RunBody = {};
  try {
    json = text ? (JSON.parse(text) as RunBody) : {};
  } catch {
    json = {};
  }
  return { status: res.status, json, text };
}

/** Start a run of the glossary agent with these inputs and wait for its text result. */
export async function creaoRun(args: { inputs: Record<string, string>; timeoutMs: number }): Promise<{ text: string; runId: string; credits: number | null; usage: { inputTokens: number; outputTokens: number } }> {
  const appId = process.env.CREAO_APP_ID;
  if (!appId) throw new AppError("MODEL_CALL_FAILED", "CREAO_APP_ID is not set");
  const t0 = performance.now();
  const left = () => args.timeoutMs - (performance.now() - t0);
  const inputChars = Object.values(args.inputs).reduce((n, v) => n + v.length, 0);

  let runId = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    log.info(`creao run start: POST /apps/${appId}/runs attempt ${attempt}/2 (${Object.keys(args.inputs).join(", ")}; ${inputChars} chars)`);
    try {
      const r = await call("POST", `/apps/${appId}/runs`, { inputs: args.inputs }, left());
      if (r.status >= 200 && r.status < 300 && r.json.id) {
        runId = r.json.id;
        log.info(`creao run ${runId} accepted (${r.status}, status ${r.json.status ?? "?"}) in ${Math.round(performance.now() - t0)}ms`);
        break;
      }
      const retryable = r.status === 429 || r.status >= 500;
      log.warn(`creao run start answered ${r.status}${retryable && attempt === 1 ? ", retrying once" : ""}: ${r.text.slice(0, 300)}`);
      if (!retryable || attempt === 2) throw new AppError("MODEL_CALL_FAILED", `creao answered ${r.status} to the run start: ${r.json.errorCode ?? r.text.slice(0, 160)}`, { context: { status: r.status } });
    } catch (err) {
      if (err instanceof AppError) throw err;
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      log.warn(`creao run start attempt ${attempt}/2 ${timedOut ? "timed out" : `failed: ${(err as Error).message}`}`, { err });
      if (timedOut || attempt === 2) throw new AppError(timedOut ? "MODEL_TIER_TIMEOUT" : "MODEL_CALL_FAILED", `creao run did not start: ${(err as Error).message}`, { cause: err });
    }
    await sleep(800);
  }

  const pollMs = Number(process.env.CREAO_POLL_MS) > 0 ? Number(process.env.CREAO_POLL_MS) : CREAO_DEFAULTS.pollMs;
  let polls = 0;
  let failuresInRow = 0;
  let lastStatus = "pending";
  while (left() > 0) {
    await sleep(Math.min(pollMs, Math.max(0, left())));
    polls++;
    try {
      const r = await call("GET", `/apps/${appId}/runs/${runId}`, undefined, Math.min(10_000, left()));
      if (r.status !== 200) {
        failuresInRow++;
        log.warn(`creao run ${runId} poll ${polls} answered ${r.status} (${failuresInRow} in a row): ${r.text.slice(0, 200)}`);
        if (r.status === 404 || r.status === 401 || failuresInRow >= 3) throw new AppError("MODEL_CALL_FAILED", `creao run ${runId} poll answered ${r.status}`, { context: { status: r.status } });
        continue;
      }
      failuresInRow = 0;
      const status = r.json.status ?? "unknown";
      if (status !== lastStatus) log.info(`creao run ${runId} status ${lastStatus} -> ${status} after ${Math.round(performance.now() - t0)}ms (poll ${polls})`);
      lastStatus = status;
      if (status === "completed") {
        const text = r.json.result?.text || r.json.result?.chatText || "";
        const credits = typeof r.json.usage?.credits === "number" ? r.json.usage.credits : null;
        log.info(`creao run ${runId} completed in ${Math.round(performance.now() - t0)}ms after ${polls} polls: ${text.length} chars of text, ${r.json.result?.artifacts?.length ?? 0} artifacts, credits ${credits ?? "not reported"}`);
        if (!text) throw new AppError("MODEL_CALL_FAILED", `creao run ${runId} completed with no text`);
        return { text, runId, credits, usage: { inputTokens: 0, outputTokens: 0 } };
      }
      if (status === "failed" || status === "cancelled") throw new AppError("MODEL_CALL_FAILED", `creao run ${runId} ${status}${r.json.errorCode ? ` (${r.json.errorCode})` : ""}`);
    } catch (err) {
      if (err instanceof AppError) throw err;
      failuresInRow++;
      log.warn(`creao run ${runId} poll ${polls} failed (${failuresInRow} in a row): ${(err as Error).message}`, { err });
      if (failuresInRow >= 3) throw new AppError("MODEL_CALL_FAILED", `creao run ${runId} polls kept failing`, { cause: err });
    }
  }
  log.warn(`creao run ${runId} still ${lastStatus} after ${args.timeoutMs}ms (${polls} polls), giving up on it`);
  throw new AppError("MODEL_TIER_TIMEOUT", `creao run ${runId} not finished within ${args.timeoutMs}ms (last status ${lastStatus})`);
}
