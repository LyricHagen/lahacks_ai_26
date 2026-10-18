import "server-only";
// THE model gate. Every model call in this codebase goes through callModel. Nothing else may
// import a provider SDK (@anthropic-ai/sdk is imported here and nowhere else).
//
//   const r = await callModel({ purpose: "gate_check", input: {}, user, mode });
//   if (r.source === "live") ...      // real model output, metered
//   if (r.source === "fixture") ...   // committed demo result; show r.note
//   if (r.source === "none") ...      // no live result allowed and no fixture; show r.code
//
// Checks, in order, each logged as "gate N/6 <check>: pass|FAIL ...":
//   1 mode is live   2 user is approved   3 under the live call rate limit (per account and per IP)
//   4 user under daily token budget   5 global daily budget not exhausted   6 provider key exists
// Any failure (and any provider error) falls back to a demo result instead of throwing: first the
// recorded live result for this exact input (fixtures/model/, "fixture HIT"), else the purpose's
// deterministic demo result ("fixture MISS ... hash=..."). Every call writes exactly one
// usage_log row, whatever the outcome.
//
// Tiers: a purpose may list a chain of providers (spec.tiers), tried in order after the checks
// pass. understand_ask is: the fine-tuned small model on Veri (finetune), then the frontier model
// (frontier), then the deterministic demo result as always. Each failed or timed out tier is logged
// ("tier 1/2 finetune FAILED ... falling to tier 2 frontier"), and the usage row says which tier
// served and why (usage_log.tier, tier_note). The eval forces one tier with args.tier.
//
// Providers: anthropic (default), veri (the fine-tune), stepfun (step-5-preview, images for
// read_screenshot) and creao (the glossary agent on agent.creao.ai, resolve_jargon). Gate 6 checks
// the key of the provider the purpose's request names. The stepfun and creao modules, like veri,
// are imported here and nowhere else.
//
// Scripts run by the owner (pnpm fixtures:record) wrap their work in runAsScript: inside it the
// gate sees the script actor instead of the session user, and every live answer is handed to the
// script's recorder. The web server never runs inside runAsScript (gate 2 refuses it there).

import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { q } from "@/db";
import * as t from "@/db/schema";
import type { SessionUser } from "./auth";
import { getBudgetState } from "./budget";
import { type ErrorCode, toAppError } from "./errors";
import { createLogger, currentReqId } from "./log";
import { hasProviderKey, MODE_REASON_LABEL, type Mode, type ResolvedMode } from "./mode";
import { type FixtureKey, fixtureKey, fromPlaceholders, isRecordedPurpose, lookupRecorded, normalizeForKey, toPlaceholders } from "./model-fixtures";
import { estimateCostUsd, type ModelUsage, trackModelCall } from "./model-log";
import { creaoRun } from "./model-creao";
import { stepfunChat } from "./model-stepfun";
import { type VeriConfig, veriChat } from "./model-veri";
import { PURPOSES, type PurposeName } from "./model-purposes";
import { span, spanAttr } from "./observe";
import { clientIp, countAttempt } from "./rate-limit";

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
  /** Put the system prompt in the provider's prompt cache (it must be the same for every call). */
  cacheSystem?: boolean;
  /** Who serves it. Default anthropic. */
  provider?: ModelProvider;
  /** Images sent with the prompt (provider stepfun only). Never logged; the caller logs size and hash. */
  images?: Array<{ mime: string; base64: string }>;
  /** The agent's named inputs (provider creao only). The prompt is not sent to CREAO. */
  creaoInputs?: Record<string, string>;
  /** Deployment and model name, for provider veri. */
  veri?: VeriConfig;
};

export type ModelProvider = "anthropic" | "veri" | "stepfun" | "creao";

/** The env vars a provider needs before gate 6 lets a call through. */
export const PROVIDER_KEYS: Record<ModelProvider, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  veri: ["VERI_API_KEY"],
  stepfun: ["STEPFUN_API_KEY"],
  creao: ["CREAO_API_KEY", "CREAO_APP_ID"],
};

/** Which link of a purpose's chain served a call. "frontier" is spec.request(). */
export type TierName = "finetune" | "base" | "frontier" | "sonnet";
export type TierRequest = { tier: TierName; req: ModelRequest | null; /** why req is null */ unavailable?: string; /** false: only when forced (the eval's base model) */ chain: boolean };

/** One kind of model call. Registered in src/lib/model-purposes.ts. */
export type PurposeSpec<I, O> = {
  request(input: I): ModelRequest;
  /** Turn model text into the typed output. Throw if it is unusable (counts as provider_error). */
  parse(text: string, input: I): O;
  /** The committed demo result for this input, or null when none exists. */
  fixture(input: I): O | null;
  /** Short id for the log and the usage row (an ask id, a batch number). */
  describe?(input: I): string;
  /**
   * What identifies this input for a recorded fixture: the input without per-run ids (ask id,
   * owner). Hashed by fixtureHash (src/lib/model-fixtures.ts). Absent: the purpose is never recorded.
   */
  key?(input: I): unknown;
  /** Providers tried before spec.request() (the frontier tier), in order. */
  tiers?(input: I): TierRequest[];
};

type SpecOf<P extends PurposeName> = (typeof PURPOSES)[P];
export type PurposeInput<P extends PurposeName> = SpecOf<P> extends PurposeSpec<infer I, unknown> ? I : never;
export type PurposeOutput<P extends PurposeName> = SpecOf<P> extends PurposeSpec<never, infer O> ? O : never;

/** A command-line script run by the owner (pnpm fixture:generate). Refused inside the web server. */
export type ScriptActor = { kind: "script"; name: string };

/** A live answer handed to the recording script (pnpm fixtures:record). */
export type LiveRecord = { purpose: string; hash: string; label: string; input: unknown; output: unknown; model: string; usage: ModelUsage; tier: TierName; ms: number };

export type ScriptRun = {
  actor: ScriptActor;
  /** Called with every live answer inside the run. */
  record?: (r: LiveRecord) => void;
  /** Serve an already recorded answer instead of calling live (re-runs only pay for new inputs). */
  preferRecorded?: boolean;
  /** Called for every demo result served inside the run, so a script can count hits and misses. */
  onFixture?: (f: { purpose: string; kind: FixtureKind; hash: string | null; askIds: string[]; output: unknown }) => void;
};

const scriptRuns = new AsyncLocalStorage<ScriptRun>();

/** Runs fn with the gate seeing a script actor. Only for command-line scripts. */
export function runAsScript<T>(run: ScriptRun, fn: () => Promise<T>): Promise<T> {
  return scriptRuns.run(run, fn);
}

/** Where a demo result came from: a recorded live answer, or the purpose's deterministic builder. */
export type FixtureKind = "recorded" | "deterministic";

export type GateOutcome = "live" | "mode_demo" | "not_approved" | "rate_limited" | "user_budget" | "global_budget" | "no_api_key" | "provider_error";

export type ModelResult<O> =
  | { source: "live"; output: O; outcome: "live"; model: string; usage: ModelUsage; costUsd: number | null; ms: number; tier: TierName; provider: string; tierNote: string }
  | { source: "fixture"; output: O; outcome: Exclude<GateOutcome, "live">; note: string; fixture: { kind: FixtureKind; hash: string | null; /** the live call the recording came from */ recorded?: { tier: TierName; ms: number; model: string } } }
  | { source: "none"; output: null; outcome: Exclude<GateOutcome, "live">; note: string; code: ErrorCode };

const OUTCOME_NOTE: Record<Exclude<GateOutcome, "live">, string> = {
  mode_demo: "demo mode",
  not_approved: "this account is not approved for live calls",
  rate_limited: "too many live calls in the last hour",
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

type CallArgs<P extends PurposeName> = {
  purpose: P;
  input: PurposeInput<P>;
  user: SessionUser | ScriptActor | null;
  mode: ResolvedMode | Mode;
  /** Ask this call belongs to, for the usage row. */
  askId?: string;
  /** Force one tier only (the eval). Default: the purpose's chain, then the frontier. */
  tier?: TierName;
};

/** The gate, inside one Sentry span per call (op ai.model) tagged with the source and the tier that served. */
export async function callModel<P extends PurposeName>(args: CallArgs<P>): Promise<ModelResult<PurposeOutput<P>>> {
  const mode = typeof args.mode === "string" ? args.mode : args.mode.mode;
  return span(`model.${args.purpose}`, "ai.model", { purpose: args.purpose, mode, ask_id: args.askId, forced_tier: args.tier }, async () => {
    const r = await gate(args);
    spanAttr("model.source", r.source);
    if (r.source === "live") {
      spanAttr("model.tier", r.tier);
      spanAttr("model.name", r.model);
      spanAttr("model.ms", r.ms);
    } else if (r.source === "fixture") spanAttr("model.outcome", r.outcome);
    return r;
  });
}

async function gate<P extends PurposeName>(args: CallArgs<P>): Promise<ModelResult<PurposeOutput<P>>> {
  const spec = PURPOSES[args.purpose] as unknown as PurposeSpec<PurposeInput<P>, PurposeOutput<P>>;
  const mode: Mode = typeof args.mode === "string" ? args.mode : args.mode.mode;
  const run = scriptRuns.getStore();
  if (run && process.env.NEXT_RUNTIME) log.warn(`runAsScript context ignored inside the web server for ${args.purpose}`);
  const actor = run && !process.env.NEXT_RUNTIME ? run.actor : args.user;
  const isScript = actor !== null && "kind" in actor && actor.kind === "script";
  const userId = args.user && !("kind" in args.user) ? (args.user as SessionUser).id : null;
  const who = isScript ? `script:${(actor as ScriptActor).name}${userId ? ` as ${userId}` : ""}` : (userId ?? "signed-out");
  const label = `${args.purpose}${spec.describe ? ` ${spec.describe(args.input)}` : ""}`;
  const req = spec.request(args.input);
  const t0 = performance.now();
  let fkey: FixtureKey | null | undefined;
  const fixKey = () => (fkey === undefined ? (fkey = spec.key ? fixtureKey(args.purpose, spec.key(args.input)) : null) : fkey);
  const keyHash = () => fixKey()?.hash ?? null;
  let hash: string | null = null;

  log.info(`call ${label} for ${who} requested in mode ${mode}`, { purpose: args.purpose, model: req.model, askId: args.askId });

  hash = keyHash();
  if (run?.preferRecorded && hash) {
    const rec = recorded();
    if (rec) {
      log.branch(`serve recorded answer for ${label} without a live call`, `the script asked for recorded answers first and hash=${hash} is recorded`);
      run.onFixture?.({ purpose: args.purpose, kind: "recorded", hash: keyHash(), askIds: fixKey()?.askIds ?? [], output: rec });
      await writeUsage({ outcome: "mode_demo", demo: true, usage: { inputTokens: 0, outputTokens: 0 }, ms: Math.round(performance.now() - t0), costUsd: 0, errorCode: null, model: req.model, provider: "fixture", tier: "fixture", tierNote: "recorded answer served to a script" });
      return { source: "fixture", output: rec, outcome: "mode_demo", note: "Cached demo result: recorded earlier.", fixture: { kind: "recorded", hash: keyHash(), recorded: recordedMeta() } };
    }
  }

  const outcome = await runChecks();
  if (outcome !== "live") return fallback(outcome);

  // All six checks passed: spend, tier by tier.
  const tiers = chain();
  const notes: string[] = [];
  let failedCost = 0;
  let lastCode: ErrorCode = "MODEL_CALL_FAILED";
  let spentTotal: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  for (const [i, t] of tiers.entries()) {
    const at = `tier ${i + 1}/${tiers.length} ${t.tier}`;
    if (!t.req) {
      log.skip(`${at} for ${label}`, t.unavailable ?? "not configured");
      notes.push(`${t.tier} skipped (${t.unavailable ?? "not configured"})`);
      continue;
    }
    const tr = t.req;
    const prov = tr.provider ?? "anthropic";
    const t1 = performance.now();
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    let rawText = "";
    try {
      const output = await trackModelCall(args.purpose, tr.model, async () => {
        if (prov === "stepfun") {
          const r = await stepfunChat({ model: tr.model, system: tr.system, prompt: tr.prompt, images: tr.images ?? [], maxTokens: tr.maxTokens, timeoutMs: tr.timeoutMs ?? 45_000, effort: tr.effort });
          usage = r.usage;
          rawText = r.text;
          return { result: spec.parse(r.text, args.input), usage };
        }
        if (prov === "creao") {
          const r = await creaoRun({ inputs: tr.creaoInputs ?? {}, timeoutMs: tr.timeoutMs ?? 30_000 });
          usage = r.usage;
          rawText = r.text;
          notes.push(`creao run ${r.runId}${r.credits !== null ? ` (${r.credits} credits)` : ""}`);
          return { result: spec.parse(r.text, args.input), usage };
        }
        if (prov === "veri") {
          const r = await veriChat({ config: tr.veri!, messages: [{ role: "system", content: tr.system }, { role: "user", content: tr.prompt }], maxTokens: tr.maxTokens, timeoutMs: tr.timeoutMs ?? 2500 });
          usage = r.usage;
          rawText = r.text;
          return { result: spec.parse(r.text, args.input), usage };
        }
        const r = await provider().messages.create(
          {
            model: tr.model,
            max_tokens: tr.maxTokens,
            system: tr.cacheSystem ? [{ type: "text" as const, text: tr.system, cache_control: { type: "ephemeral" as const } }] : tr.system,
            messages: [{ role: "user", content: tr.prompt }],
            ...(tr.effort || tr.jsonSchema
              ? { output_config: { ...(tr.effort ? { effort: tr.effort } : {}), ...(tr.jsonSchema ? { format: { type: "json_schema" as const, schema: tr.jsonSchema } } : {}) } }
              : {}),
          },
          tr.timeoutMs ? { timeout: tr.timeoutMs } : undefined,
        );
        // Cache reads and writes are billed apart from input_tokens; fold them in at their price ratios
        // (read 0.1x, write 1.25x) so cost estimates and budgets stay honest.
        const cached = (r.usage.cache_read_input_tokens ?? 0) * 0.1 + (r.usage.cache_creation_input_tokens ?? 0) * 1.25;
        usage = { inputTokens: r.usage.input_tokens + Math.round(cached), outputTokens: r.usage.output_tokens };
        if (r.stop_reason === "refusal") throw new Error(`model refused (stop_reason refusal, category ${r.stop_details?.category ?? "none"})`);
        if (r.stop_reason === "max_tokens") log.warn(`${label} hit max_tokens (${tr.maxTokens}); output may be cut off`);
        const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        rawText = text;
        return { result: spec.parse(text, args.input), usage };
      });
      const tierMs = Math.round(performance.now() - t1);
      const ms = Math.round(performance.now() - t0);
      const costUsd = (estimateCostUsd(tr.model, usage, tierMs) ?? 0) + failedCost;
      const tierNote = [...notes, `${t.tier} served in ${tierMs}ms`].join("; ");
      spentTotal = { inputTokens: spentTotal.inputTokens + usage.inputTokens, outputTokens: spentTotal.outputTokens + usage.outputTokens };
      await writeUsage({ outcome: "live", demo: false, usage: spentTotal, ms, costUsd, errorCode: null, model: tr.model, provider: prov, tier: t.tier, tierNote });
      log.info(`call ${label} answered live by ${at} (${prov}:${tr.model}) in ${tierMs}ms`, { tokens: usage.inputTokens + usage.outputTokens, costUsd, tierNote });
      if (run?.record && keyHash() && isRecordedPurpose(args.purpose)) {
        // The model's own JSON, as it came back: replay runs it through the same parse() as a live answer.
        run.record({ purpose: args.purpose, hash: keyHash()!, label, input: spec.key!(args.input), output: toPlaceholders(asJson(rawText), fixKey()!.askIds), model: tr.model, usage, tier: t.tier, ms: tierMs });
        log.info(`recorded ${label} as hash=${hash} (${t.tier}, ${tierMs}ms)`, { purpose: args.purpose });
      }
      return { source: "live", output, outcome: "live", model: tr.model, usage, costUsd, ms: tierMs, tier: t.tier, provider: prov, tierNote };
    } catch (err) {
      const e = toAppError(err, "MODEL_CALL_FAILED");
      const cause = (err as { cause?: unknown }).cause;
      const inner = cause instanceof Error || (cause && typeof cause === "object") ? toAppError(cause, "MODEL_CALL_FAILED") : e;
      lastCode = inner.code === "UNKNOWN" ? "MODEL_CALL_FAILED" : inner.code;
      const tierMs = Math.round(performance.now() - t1);
      failedCost += estimateCostUsd(tr.model, usage, tierMs) ?? 0;
      spentTotal = { inputTokens: spentTotal.inputTokens + usage.inputTokens, outputTokens: spentTotal.outputTokens + usage.outputTokens };
      notes.push(`${t.tier} failed with ${lastCode} after ${tierMs}ms (${inner.message.slice(0, 120)})`);
      const next = tiers.slice(i + 1).find((x) => x.req);
      if (next) log.warn(`${at} FAILED for ${label} with ${lastCode} after ${tierMs}ms (${inner.message.slice(0, 160)}), falling to tier ${tiers.indexOf(next) + 1}/${tiers.length} ${next.tier}`, { err });
      else log.error(`call ${label} failed live with ${lastCode} on ${at}, falling back to the demo fixture`, { err });
    }
  }
  return fallback("provider_error", spentTotal, lastCode, failedCost, notes.join("; ") || "no tier configured");

  /** The tiers to try: the forced one, or the purpose's chain followed by the frontier request. */
  function chain(): TierRequest[] {
    const listed = spec.tiers?.(args.input) ?? [];
    const all: TierRequest[] = [...listed, { tier: "frontier", req, chain: true }];
    if (args.tier) {
      const forced = all.find((t) => t.tier === args.tier);
      log.branch(`${label} forced to tier ${args.tier}`, "the caller asked for one tier only (eval)");
      return forced ? [forced] : [{ tier: args.tier, req: null, unavailable: `purpose ${args.purpose} has no ${args.tier} tier`, chain: false }];
    }
    const used = all.filter((t) => t.chain);
    log.debug(`${label} tier chain: ${used.map((t) => `${t.tier}${t.req ? `=${t.req.provider ?? "anthropic"}:${t.req.model}` : ` (unavailable: ${t.unavailable})`}`).join(" -> ")} -> deterministic`);
    return used;
  }

  async function runChecks(): Promise<GateOutcome> {
    const step = (n: number, name: string, pass: boolean, detail: string) => {
      if (pass) log.debug(`gate ${n}/6 ${name}: pass (${detail})`);
      else log.info(`gate ${n}/6 ${name}: FAIL (${detail}), using the demo fixture`);
      return pass;
    };
    const resolvedReason = typeof args.mode === "string" ? "given as a string" : `resolveMode said ${args.mode.reason}`;
    if (!step(1, "mode is live", mode === "live", `mode ${mode}, ${resolvedReason}`)) return "mode_demo";

    if (isScript) {
      const inServer = !!process.env.NEXT_RUNTIME;
      if (!step(2, "user is approved", !inServer, inServer ? "script actor used inside the web server, refused" : "script run from the command line by the owner")) return "not_approved";
    } else {
      const u = args.user as SessionUser | null;
      if (!step(2, "user is approved", !!u && u.status === "approved" && !u.isDemo, u ? `${u.id} status ${u.status}${u.isDemo ? ", shared demo account (never live)" : ""}` : "signed out")) return "not_approved";
    }

    // Check 3: live calls per account and per network address in the last hour (rate_limits).
    if (isScript) log.skip("gate 3/6 rate limit", "script actor runs from the command line, outside any request");
    else {
      const ip = await clientIp().catch(() => "unknown");
      const byUser = await countAttempt("model_user", userId!);
      const byIp = await countAttempt("model_ip", ip);
      if (!step(3, "under the live call rate limit", byUser.allowed && byIp.allowed, `${userId} ${byUser.count} of ${byUser.limit}, ${ip} ${byIp.count} of ${byIp.limit} this hour`)) return "rate_limited";
    }

    const budget = await getBudgetState(userId);
    if (isScript) log.skip("gate 4/6 user budget", "script actor has no per-user budget; the global budget still applies");
    else if (!step(4, "user under daily budget", (budget.userUsed ?? 0) < budget.userLimit, `${budget.userUsed ?? 0} of ${budget.userLimit} tokens today`)) return "user_budget";
    if (!step(5, "global budget not exhausted", budget.globalUsed < budget.globalLimit, `${budget.globalUsed} of ${budget.globalLimit} tokens today`)) return "global_budget";
    const veriOnly = args.tier === "finetune" || args.tier === "base";
    const prov: ModelProvider = veriOnly ? "veri" : (req.provider ?? "anthropic");
    const missing = PROVIDER_KEYS[prov].filter((k) => !process.env[k]);
    const keyOk = prov === "anthropic" ? hasProviderKey() : missing.length === 0;
    if (!step(6, "provider key exists", keyOk, keyOk ? `${PROVIDER_KEYS[prov].join(", ")} set (provider ${prov})` : `${missing.join(", ") || "ANTHROPIC_API_KEY"} not set (provider ${prov})`)) return "no_api_key";
    return "live";
  }

  /** The recorded live answer for this exact input, re-validated by the purpose's own parser. */
  function recorded(): PurposeOutput<P> | null {
    const h = keyHash();
    const rec = h ? lookupRecorded(args.purpose, h) : null;
    if (!rec) return null;
    try {
      const raw = fromPlaceholders(rec.output, fixKey()!.askIds);
      return spec.parse(typeof raw === "string" ? raw : JSON.stringify(raw), args.input);
    } catch (err) {
      log.warn(`recorded answer for ${label} hash=${h} no longer parses (${(err as Error).message}), ignoring it`, { err, recordedAt: rec.recordedAt });
      return null;
    }
  }

  /** Which live call a recorded answer came from, so demo mode can show its real latency. */
  function recordedMeta(): { tier: TierName; ms: number; model: string } | undefined {
    const h = keyHash();
    const rec = h ? lookupRecorded(args.purpose, h) : null;
    return rec?.ms !== undefined ? { tier: (rec.tier as TierName) ?? "frontier", ms: rec.ms, model: rec.model } : undefined;
  }

  async function fallback(why: Exclude<GateOutcome, "live">, spent: ModelUsage = { inputTokens: 0, outputTokens: 0 }, errorCode: ErrorCode | null = null, spentUsd = 0, tierNote: string | null = null): Promise<ModelResult<PurposeOutput<P>>> {
    const ms = Math.round(performance.now() - t0);
    const h = keyHash();
    const rec = recorded();
    const kind: FixtureKind = rec ? "recorded" : "deterministic";
    if (rec) log.info(`fixture HIT ${args.purpose} hash=${h} for ${label}: replaying the recorded live answer`, { purpose: args.purpose });
    else if (h) {
      log.info(`fixture MISS ${args.purpose} hash=${h} for ${label}: no recorded live answer for this input, using the deterministic demo result (pnpm fixtures:record adds it)`, { purpose: args.purpose });
      // Diff two of these to see why an input stopped matching its recording.
      log.trace(`fixture key ${args.purpose} hash=${h} ${JSON.stringify(normalizeForKey(spec.key!(args.input)))}`);
    }
    const fixture = rec ?? spec.fixture(args.input);
    // A failed live call can still have consumed tokens (bad JSON, refusal); record and price them.
    const costUsd = spentUsd || (spent.inputTokens || spent.outputTokens ? estimateCostUsd(req.model, spent) : 0);
    const servedBy = `deterministic${rec ? " (recorded)" : ""}`;
    await writeUsage({ outcome: why, demo: true, usage: spent, ms, costUsd, errorCode: fixture ? errorCode : (errorCode ?? "MODEL_FIXTURE_MISSING"), model: req.model, provider: "fixture", tier: rec ? "recorded" : "deterministic", tierNote: tierNote ? `${tierNote}; ${servedBy} served` : `${OUTCOME_NOTE[why]}; ${servedBy} served` });
    const modeWhy = why === "mode_demo" && typeof args.mode !== "string" ? ` (${MODE_REASON_LABEL[args.mode.reason]})` : "";
    const note = `Cached demo result: ${OUTCOME_NOTE[why]}${modeWhy}.`;
    if (fixture) {
      log.branch(`serve ${kind} demo result for ${label}`, OUTCOME_NOTE[why], { outcome: why, hash: h });
      run?.onFixture?.({ purpose: args.purpose, kind, hash: h, askIds: fixKey()?.askIds ?? [], output: fixture });
      return { source: "fixture", output: fixture, outcome: why, note, fixture: { kind, hash: h, recorded: rec ? recordedMeta() : undefined } };
    }
    log.warn(`no demo fixture for ${label}, caller must show an empty or error state`, { outcome: why, code: "MODEL_FIXTURE_MISSING" });
    return { source: "none", output: null, outcome: why, note: `No result: ${OUTCOME_NOTE[why]} and no cached demo result exists.`, code: "MODEL_FIXTURE_MISSING" };
  }

  async function writeUsage(row: { outcome: GateOutcome; demo: boolean; usage: ModelUsage; ms: number; costUsd: number | null; errorCode: ErrorCode | null; model: string; provider: string; tier: string; tierNote: string }) {
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
          provider: row.provider,
          tier: row.tier,
          tierNote: row.tierNote.slice(0, 500),
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

/** Model text as stored in a recording: parsed JSON when it is JSON (readable diffs), else the text. */
function asJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Plain note for the UI when a result did not come from a live call. */
export function sourceNote(r: { source: string; outcome: string }): string | null {
  if (r.source === "live") return null;
  return `Cached demo result: ${OUTCOME_NOTE[r.outcome as Exclude<GateOutcome, "live">] ?? r.outcome}.`;
}

