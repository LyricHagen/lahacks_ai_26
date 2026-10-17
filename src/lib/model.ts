import "server-only";
// THE model gate. Every model call in this codebase goes through callModel. Nothing else may
// import a provider SDK (@anthropic-ai/sdk is imported here and nowhere else).
//
//   const r = await callModel({ purpose: "gate_check", input: {}, user, mode });
//   if (r.source === "live") ...      // real model output, metered
//   if (r.source === "fixture") ...   // committed demo result; show r.note
//   if (r.source === "none") ...      // no live result allowed and no fixture; show r.code
//
// Checks, in order, each logged as "gate N/5 <check>: pass|FAIL ...":
//   1 mode is live   2 user is approved   3 user under daily token budget
//   4 global daily budget not exhausted   5 provider key exists
// Any failure (and any provider error) falls back to the purpose's demo fixture instead of
// throwing. Every call writes exactly one usage_log row, whatever the outcome.

import Anthropic from "@anthropic-ai/sdk";
import { q } from "@/db";
import * as t from "@/db/schema";
import type { SessionUser } from "./auth";
import { getBudgetState } from "./budget";
import { type ErrorCode, toAppError } from "./errors";
import { createLogger, currentReqId } from "./log";
import { hasProviderKey, MODE_REASON_LABEL, type Mode, type ResolvedMode } from "./mode";
import { estimateCostUsd, type ModelUsage, trackModelCall } from "./model-log";
import { PURPOSES, type PurposeName } from "./model-purposes";

const log = createLogger("model.gate");

/** What a purpose asks the provider for. */
export type ModelRequest = {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  /** JSON schema for structured output. The parsed text is passed to parse(). */
  jsonSchema?: Record<string, unknown>;
  timeoutMs?: number;
};

/** One kind of model call. Registered in src/lib/model-purposes.ts. */
export type PurposeSpec<I, O> = {
  request(input: I): ModelRequest;
  /** Turn model text into the typed output. Throw if it is unusable (counts as provider_error). */
  parse(text: string, input: I): O;
  /** The committed demo result for this input, or null when none exists. */
  fixture(input: I): O | null;
  /** Short id for the log and the usage row (an ask id, a batch number). */
  describe?(input: I): string;
};

type SpecOf<P extends PurposeName> = (typeof PURPOSES)[P];
export type PurposeInput<P extends PurposeName> = SpecOf<P> extends PurposeSpec<infer I, unknown> ? I : never;
export type PurposeOutput<P extends PurposeName> = SpecOf<P> extends PurposeSpec<never, infer O> ? O : never;

/** A command-line script run by the owner (pnpm fixture:generate). Refused inside the web server. */
export type ScriptActor = { kind: "script"; name: string };

export type GateOutcome = "live" | "mode_demo" | "not_approved" | "user_budget" | "global_budget" | "no_api_key" | "provider_error";

export type ModelResult<O> =
  | { source: "live"; output: O; outcome: "live"; model: string; usage: ModelUsage; costUsd: number | null; ms: number }
  | { source: "fixture"; output: O; outcome: Exclude<GateOutcome, "live">; note: string }
  | { source: "none"; output: null; outcome: Exclude<GateOutcome, "live">; note: string; code: ErrorCode };

const OUTCOME_NOTE: Record<Exclude<GateOutcome, "live">, string> = {
  mode_demo: "demo mode",
  not_approved: "this account is not approved for live calls",
  user_budget: "your daily token budget is used up",
  global_budget: "today's shared token budget is used up",
  no_api_key: "the server has no model key",
  provider_error: "the live model call failed",
};

let client: Anthropic | null = null;
function provider(): Anthropic {
  // maxRetries 1: the SDK retries 408/409/429/5xx and connection errors once, then we fall back.
  return (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 }));
}

export async function callModel<P extends PurposeName>(args: {
  purpose: P;
  input: PurposeInput<P>;
  user: SessionUser | ScriptActor | null;
  mode: ResolvedMode | Mode;
  /** Ask this call belongs to, for the usage row. */
  askId?: string;
}): Promise<ModelResult<PurposeOutput<P>>> {
  const spec = PURPOSES[args.purpose] as unknown as PurposeSpec<PurposeInput<P>, PurposeOutput<P>>;
  const mode: Mode = typeof args.mode === "string" ? args.mode : args.mode.mode;
  const isScript = args.user !== null && "kind" in args.user && args.user.kind === "script";
  const userId = args.user && !isScript ? (args.user as SessionUser).id : null;
  const who = isScript ? `script:${(args.user as ScriptActor).name}` : (userId ?? "signed-out");
  const label = `${args.purpose}${spec.describe ? ` ${spec.describe(args.input)}` : ""}`;
  const req = spec.request(args.input);
  const t0 = performance.now();

  log.info(`call ${label} for ${who} requested in mode ${mode}`, { purpose: args.purpose, model: req.model, askId: args.askId });

  const outcome = await runChecks();
  if (outcome !== "live") return fallback(outcome);

  // All five checks passed: spend.
  let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    const output = await trackModelCall(args.purpose, req.model, async () => {
      const r = await provider().messages.create(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
          ...(req.effort || req.jsonSchema
            ? { output_config: { ...(req.effort ? { effort: req.effort } : {}), ...(req.jsonSchema ? { format: { type: "json_schema" as const, schema: req.jsonSchema } } : {}) } }
            : {}),
        },
        req.timeoutMs ? { timeout: req.timeoutMs } : undefined,
      );
      usage = { inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens };
      if (r.stop_reason === "refusal") throw new Error(`model refused (stop_reason refusal, category ${r.stop_details?.category ?? "none"})`);
      if (r.stop_reason === "max_tokens") log.warn(`${label} hit max_tokens (${req.maxTokens}); output may be cut off`);
      const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { result: spec.parse(text, args.input), usage };
    });
    const ms = Math.round(performance.now() - t0);
    const costUsd = estimateCostUsd(req.model, usage);
    await writeUsage({ outcome: "live", demo: false, usage, ms, costUsd, errorCode: null, model: req.model });
    log.info(`call ${label} answered live in ${ms}ms`, { tokens: usage.inputTokens + usage.outputTokens, costUsd });
    return { source: "live", output, outcome: "live", model: req.model, usage, costUsd, ms };
  } catch (err) {
    const e = toAppError(err, "MODEL_CALL_FAILED");
    const code: ErrorCode = e.code === "UNKNOWN" ? "MODEL_CALL_FAILED" : e.code;
    log.error(`call ${label} failed live with ${code}, falling back to the demo fixture`, { err });
    return fallback("provider_error", usage, code);
  }

  async function runChecks(): Promise<GateOutcome> {
    const step = (n: number, name: string, pass: boolean, detail: string) => {
      if (pass) log.debug(`gate ${n}/5 ${name}: pass (${detail})`);
      else log.info(`gate ${n}/5 ${name}: FAIL (${detail}), using the demo fixture`);
      return pass;
    };
    const resolvedReason = typeof args.mode === "string" ? "given as a string" : `resolveMode said ${args.mode.reason}`;
    if (!step(1, "mode is live", mode === "live", `mode ${mode}, ${resolvedReason}`)) return "mode_demo";

    if (isScript) {
      const inServer = !!process.env.NEXT_RUNTIME;
      if (!step(2, "user is approved", !inServer, inServer ? "script actor used inside the web server, refused" : "script run from the command line by the owner")) return "not_approved";
    } else {
      const u = args.user as SessionUser | null;
      if (!step(2, "user is approved", !!u && u.status === "approved", u ? `${u.id} status ${u.status}` : "signed out")) return "not_approved";
    }

    const budget = await getBudgetState(userId);
    if (isScript) log.skip("gate 3/5 user budget", "script actor has no per-user budget; the global budget still applies");
    else if (!step(3, "user under daily budget", (budget.userUsed ?? 0) < budget.userLimit, `${budget.userUsed ?? 0} of ${budget.userLimit} tokens today`)) return "user_budget";
    if (!step(4, "global budget not exhausted", budget.globalUsed < budget.globalLimit, `${budget.globalUsed} of ${budget.globalLimit} tokens today`)) return "global_budget";
    if (!step(5, "provider key exists", hasProviderKey(), hasProviderKey() ? "ANTHROPIC_API_KEY set" : "ANTHROPIC_API_KEY not set")) return "no_api_key";
    return "live";
  }

  async function fallback(why: Exclude<GateOutcome, "live">, spent: ModelUsage = { inputTokens: 0, outputTokens: 0 }, errorCode: ErrorCode | null = null): Promise<ModelResult<PurposeOutput<P>>> {
    const ms = Math.round(performance.now() - t0);
    const fixture = spec.fixture(args.input);
    // A failed live call can still have consumed tokens (bad JSON, refusal); record and price them.
    const costUsd = spent.inputTokens || spent.outputTokens ? estimateCostUsd(req.model, spent) : 0;
    await writeUsage({ outcome: why, demo: true, usage: spent, ms, costUsd, errorCode: fixture ? errorCode : (errorCode ?? "MODEL_FIXTURE_MISSING"), model: req.model });
    const modeWhy = why === "mode_demo" && typeof args.mode !== "string" ? ` (${MODE_REASON_LABEL[args.mode.reason]})` : "";
    const note = `Cached demo result: ${OUTCOME_NOTE[why]}${modeWhy}.`;
    if (fixture) {
      log.branch(`serve demo fixture for ${label}`, OUTCOME_NOTE[why], { outcome: why });
      return { source: "fixture", output: fixture, outcome: why, note };
    }
    log.warn(`no demo fixture for ${label}, caller must show an empty or error state`, { outcome: why, code: "MODEL_FIXTURE_MISSING" });
    return { source: "none", output: null, outcome: why, note: `No result: ${OUTCOME_NOTE[why]} and no cached demo result exists.`, code: "MODEL_FIXTURE_MISSING" };
  }

  async function writeUsage(row: { outcome: GateOutcome; demo: boolean; usage: ModelUsage; ms: number; costUsd: number | null; errorCode: ErrorCode | null; model: string }) {
    try {
      await q("model.usage.insert", (db) =>
        db.insert(t.usageLog).values({
          userId,
          purpose: args.purpose,
          model: row.model,
          inputTokens: row.usage.inputTokens,
          outputTokens: row.usage.outputTokens,
          latencyMs: row.ms,
          costUsd: row.costUsd === null ? null : row.costUsd.toFixed(6),
          demo: row.demo,
          mode,
          outcome: row.outcome,
          errorCode: row.errorCode,
          askId: args.askId ?? null,
          reqId: currentReqId(),
        }),
      );
    } catch (err) {
      // The caller still gets its result; the missing row is loud in the log.
      log.error(`usage_log row NOT written for ${label} (outcome ${row.outcome}); spend for this call is missing from /admin/usage`, { err, tokens: row.usage.inputTokens + row.usage.outputTokens });
    }
  }
}

/** Plain note for the UI when a result did not come from a live call. */
export function sourceNote(r: { source: string; outcome: string }): string | null {
  if (r.source === "live") return null;
  return `Cached demo result: ${OUTCOME_NOTE[r.outcome as Exclude<GateOutcome, "live">] ?? r.outcome}.`;
}

