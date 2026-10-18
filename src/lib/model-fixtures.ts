import "server-only";
// Recorded model results for demo mode: one file per purpose in fixtures/model/, keyed by a hash of
// the normalized input. `pnpm fixtures:record` (scripts/record-fixtures.ts) fills them from real
// live calls, once, with the owner's key; demo mode then replays them and never calls a model.
//
// What is hashed is each purpose's key(input) (src/lib/model-purposes.ts): the input without
// per-run ids (ask id, owner), with whitespace collapsed and object keys sorted. Ask ids that are
// still inside it (the ramp plan cites "ask_1026") are numbered by first appearance instead
// (ask ids change on every Reset demo), and a recorded output stores them as {ask#1}, filled back
// in with the current ids on replay. Same question, same company, same clock: same hash. A miss
// is logged with its hash ("fixture MISS") and the caller gets the deterministic demo result
// instead, so a demo never errors on an unseen input.

import { createHash } from "node:crypto";
import draftFile from "../../fixtures/model/draft_ask.json";
import explainFile from "../../fixtures/model/explain_ranking.json";
import rampFile from "../../fixtures/model/ramp_plan.json";
import understandFile from "../../fixtures/model/understand_ask.json";

/** Bump when key() changes for every purpose, so old recordings stop matching instead of lying. */
export const FIXTURE_KEY_VERSION = 1;

export type RecordedEntry = {
  hash: string;
  /** What the input was (an example id, an ask's first words), for people reading the file. */
  label: string;
  recordedAt: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** The model's raw JSON answer (ask ids as {ask#n}); replayed through the purpose's parse(). */
  output: unknown;
  /** Which tier answered live and how long it took (shown as "parsed in 240ms" on replay). */
  tier?: string;
  ms?: number;
};

export type RecordedFile = { version: number; purpose: string; note: string; entries: Record<string, RecordedEntry> };

/** Purposes a user can trigger. gate_check and fixture_text are not recorded (see model-purposes). */
export const RECORDED_PURPOSES = ["understand_ask", "explain_ranking", "draft_ask", "ramp_plan"] as const;
export type RecordedPurpose = (typeof RECORDED_PURPOSES)[number];

const FILES: Record<RecordedPurpose, RecordedFile> = {
  understand_ask: understandFile as RecordedFile,
  explain_ranking: explainFile as RecordedFile,
  draft_ask: draftFile as RecordedFile,
  ramp_plan: rampFile as RecordedFile,
};

export function isRecordedPurpose(p: string): p is RecordedPurpose {
  return (RECORDED_PURPOSES as readonly string[]).includes(p);
}

/** Collapses whitespace in every string and sorts object keys, so formatting never changes a hash. */
export function normalizeForKey(v: unknown): unknown {
  if (typeof v === "string") return v.normalize("NFC").replace(/\s+/g, " ").trim();
  if (Array.isArray(v)) return v.map(normalizeForKey);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => [k, normalizeForKey(o[k])]),
    );
  }
  return v;
}

const ASK_ID = /\bask_\d+\b/g;

/** A key's hash plus the ask ids it contains, in order of first appearance. */
export type FixtureKey = { hash: string; askIds: string[] };

/** 16 hex chars of sha256 over the purpose, the key version and the normalized key, ask ids numbered. */
export function fixtureKey(purpose: string, key: unknown): FixtureKey {
  const text = JSON.stringify(normalizeForKey(key));
  const askIds = [...new Set(text.match(ASK_ID) ?? [])];
  const canonical = text.replace(ASK_ID, (m) => `{ask#${askIds.indexOf(m) + 1}}`);
  const hash = createHash("sha256").update(`${purpose}|${FIXTURE_KEY_VERSION}|${canonical}`).digest("hex").slice(0, 16);
  return { hash, askIds };
}

/** A live output as stored: the input's ask ids replaced by {ask#n}. */
export function toPlaceholders(output: unknown, askIds: string[]): unknown {
  if (!askIds.length) return output;
  return JSON.parse(JSON.stringify(output).replace(ASK_ID, (m) => (askIds.includes(m) ? `{ask#${askIds.indexOf(m) + 1}}` : m)));
}

/** A stored output for this input: {ask#n} back to this input's ask ids. */
export function fromPlaceholders(output: unknown, askIds: string[]): unknown {
  return JSON.parse(JSON.stringify(output).replace(/\{ask#(\d+)\}/g, (m, n: string) => askIds[Number(n) - 1] ?? m));
}

/** Entries recorded earlier in this process (the record script), checked before the files. */
const extra = new Map<string, RecordedEntry>();

export function rememberRecorded(purpose: RecordedPurpose, e: RecordedEntry): void {
  extra.set(`${purpose}:${e.hash}`, e);
}

export function lookupRecorded(purpose: string, hash: string): RecordedEntry | null {
  if (!isRecordedPurpose(purpose)) return null;
  return extra.get(`${purpose}:${hash}`) ?? FILES[purpose].entries[hash] ?? null;
}

export function recordedCounts(): Record<RecordedPurpose, number> {
  return Object.fromEntries(RECORDED_PURPOSES.map((p) => [p, Object.keys(FILES[p].entries).length])) as Record<RecordedPurpose, number>;
}
