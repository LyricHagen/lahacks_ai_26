// What Who2Ask understood about an ask, defined once. No server imports: the confirm panel (client)
// edits the same shape the server stores in asks.understanding.
//
// Three ways to get one, logged as via=...:
//   model     a live understand_ask call through callModel (src/lib/model-purposes.ts)
//   fixture   the committed demo result for a composer example (fixtures/demo/understand_ask.json)
//   keywords  extractByKeywords below: deterministic, offline, good enough to demo
//
// Keyword hits are facts (the user typed the service name), so they are always unioned into the
// model's answer. The user can then correct everything on the confirm screen.

import { z } from "zod";
import { type AskUrgency, URGENCIES } from "./ask-state";
import { cosine, embedText } from "./embed";

export const HELP_KINDS = ["where_is", "how_works", "is_expected", "unblock", "who_decides"] as const;
export type HelpKind = (typeof HELP_KINDS)[number];

export const HELP_KIND_LABEL: Record<HelpKind, string> = {
  where_is: "Where is this",
  how_works: "How does this work",
  is_expected: "Is this expected",
  unblock: "Unblock me",
  who_decides: "Who decides this",
};

export const ARTIFACT_KINDS = ["repo", "error", "dashboard", "ticket", "link", "other"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  repo: "Repo",
  error: "Error",
  dashboard: "Dashboard",
  ticket: "Ticket",
  link: "Link",
  other: "Other",
};

const urgencyEnum = z.enum(URGENCIES);
const artifact = z.object({ kind: z.enum(ARTIFACT_KINDS), text: z.string().trim().min(1).max(200) });
const sensitive = z.object({ text: z.string().trim().min(1).max(300), why: z.string().trim().min(1).max(120) });

/** Exactly what the understand_ask model call must return. Validated before anything uses it. */
export const ModelUnderstandSchema = z.object({
  restatement: z.string().trim().min(8).max(400),
  serviceIds: z.array(z.string()).max(8),
  skillIds: z.array(z.string()).max(10),
  artifacts: z.array(artifact).max(10),
  helpKind: z.enum(HELP_KINDS),
  urgency: urgencyEnum.nullable(),
  sensitive: z.array(sensitive).max(10),
});
export type ModelUnderstand = z.infer<typeof ModelUnderstandSchema>;

/** The same contract as a JSON schema for the provider's structured output (no length limits: Zod enforces those). */
export const MODEL_UNDERSTAND_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["restatement", "serviceIds", "skillIds", "artifacts", "helpKind", "urgency", "sensitive"],
  properties: {
    restatement: { type: "string" },
    serviceIds: { type: "array", items: { type: "string" } },
    skillIds: { type: "array", items: { type: "string" } },
    artifacts: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["kind", "text"], properties: { kind: { type: "string", enum: [...ARTIFACT_KINDS] }, text: { type: "string" } } },
    },
    helpKind: { type: "string", enum: [...HELP_KINDS] },
    urgency: { anyOf: [{ type: "string", enum: [...URGENCIES] }, { type: "null" }] },
    sensitive: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["text", "why"], properties: { text: { type: "string" }, why: { type: "string" } } },
    },
  },
} as const;

export type UnderstandVia = "model" | "fixture" | "keywords";
export type NamedRef = { id: string; name: string; matched: string };

/** Stored in asks.understanding. */
export type Understanding = {
  version: 2;
  via: UnderstandVia;
  /** "Cached demo result: ..." when not live, shown on the page. */
  note: string | null;
  restatement: string;
  services: NamedRef[];
  skills: NamedRef[];
  artifacts: Array<{ kind: ArtifactKind; text: string }>;
  helpKind: HelpKind;
  urgency: AskUrgency;
  /** Spans to leave out of any drafted message. Never logged (markSensitive). */
  sensitive: Array<{ text: string; why: string }>;
  words: number;
  embeddingModel: string;
  editedByUser: boolean;
  /** One short line per correction ("removed service web"), newest last. */
  edits: string[];
};

/** Old prompt 4 rows had only services, skills, urgency, words. Fill the rest so every reader sees one shape. */
export function normalizeUnderstanding(raw: unknown): Understanding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Understanding> & { version?: number };
  const services = Array.isArray(r.services) ? r.services : [];
  const skills = Array.isArray(r.skills) ? r.skills : [];
  return {
    version: 2,
    via: r.via ?? "keywords",
    note: r.note ?? null,
    restatement: r.restatement ?? "",
    services,
    skills,
    artifacts: Array.isArray(r.artifacts) ? r.artifacts : [],
    helpKind: r.helpKind && (HELP_KINDS as readonly string[]).includes(r.helpKind) ? r.helpKind : "unblock",
    urgency: r.urgency && (URGENCIES as readonly string[]).includes(r.urgency) ? r.urgency : "blocked_today",
    sensitive: Array.isArray(r.sensitive) ? r.sensitive : [],
    words: typeof r.words === "number" ? r.words : 0,
    embeddingModel: r.embeddingModel ?? "",
    editedByUser: !!r.editedByUser,
    edits: Array.isArray(r.edits) ? r.edits : [],
  };
}

/** The understanding with sensitive spans replaced, safe for any log line. */
export function understandingForLog(u: Understanding): Record<string, unknown> {
  return { ...u, sensitive: u.sensitive.map((s) => ({ text: "[sensitive]", why: s.why })) };
}

/** What the confirm panel sends back. Ids are checked against the catalog on the server. */
export const ConfirmInputSchema = z.object({
  askId: z.string().regex(/^ask_\d+$/),
  restatement: z.string().trim().min(8).max(400),
  serviceIds: z.array(z.string()).max(12),
  skillIds: z.array(z.string()).max(15),
  artifacts: z.array(artifact).max(15),
  helpKind: z.enum(HELP_KINDS),
  urgency: urgencyEnum,
  sensitive: z.array(sensitive).max(15),
  /** A document the asker says answers it, or null to go on and find a person. */
  answeredByDocId: z.string().nullable(),
});
export type ConfirmInput = z.infer<typeof ConfirmInputSchema>;

// ---------------------------------------------------------------------------
// keyword extractor (offline fallback and demo path)
// ---------------------------------------------------------------------------

export type Catalog = {
  /** embedding is the seeded service embedding, used to infer a service the ask does not name. */
  services: Array<{ id: string; name: string; repo: string; description?: string; embedding?: number[] | null }>;
  skills: Array<{ id: string; name: string; aliases: string[] }>;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word match. Short names with capitals ("Go", "SQL") must match their case, so "go" the verb does not count. */
export function findTerm(text: string, term: string): boolean {
  if (term.length < 2) return false;
  const caseSensitive = term.length <= 3 && term !== term.toLowerCase();
  return new RegExp(`(^|[^A-Za-z0-9_])${escape(term)}($|[^A-Za-z0-9_])`, caseSensitive ? "" : "i").test(text);
}

export function matchServices(text: string, catalog: Catalog): NamedRef[] {
  return catalog.services.flatMap((s) => {
    // "ingest pipeline" is how people write ingest-pipeline in a sentence.
    const spaced = s.name.includes("-") ? s.name.replace(/-/g, " ") : null;
    const term = [s.name, s.repo, spaced].find((x): x is string => !!x && findTerm(text, x));
    return term ? [{ id: s.id, name: s.name, matched: term }] : [];
  });
}

/** Calibrated on corvid-v1 scenarios: the right service scores 0.28 to 0.63 and is well clear of the next. */
export const INFER_SERVICE_MIN = 0.25;
const INFER_SERVICE_RATIO = 1.5;

/**
 * When the ask names no service, the one whose description reads clearly closest (local
 * embedding, no network). Returns null unless it is above INFER_SERVICE_MIN and well clear of the
 * runner-up, so the confirm screen only suggests a service it can stand behind.
 */
export function inferService(text: string, catalog: Catalog): { ref: NamedRef; similarity: number; runnerUp: number } | null {
  const v = embedText(text);
  const scored = catalog.services
    .filter((s) => s.embedding?.length)
    .map((s) => ({ s, sim: cosine(v, s.embedding!) }))
    .sort((a, b) => b.sim - a.sim);
  const [top, next] = scored;
  if (!top || top.sim < INFER_SERVICE_MIN || (next && top.sim < next.sim * INFER_SERVICE_RATIO)) return null;
  return { ref: { id: top.s.id, name: top.s.name, matched: `similar wording (${top.sim.toFixed(2)})` }, similarity: top.sim, runnerUp: next?.sim ?? 0 };
}

export function matchSkills(text: string, catalog: Catalog): NamedRef[] {
  return catalog.skills.flatMap((s) => {
    const term = [s.name, ...s.aliases].find((x) => findTerm(text, x));
    return term ? [{ id: s.id, name: s.name, matched: term }] : [];
  });
}

export function detectHelpKind(text: string): { kind: HelpKind; why: string } {
  const t = text.toLowerCase();
  const rules: Array<[HelpKind, RegExp, string]> = [
    ["is_expected", /\b(is (this|that|it) (expected|normal)|expected\b|supposed to|normal\?)/, "asks whether something is expected"],
    ["who_decides", /\b(who (decides|approves|signs off)|whose call|approv(e|al)|allowed to|can i (expense|get)|raise my limit|policy)\b/, "asks for a decision or an approval"],
    ["where_is", /\b(where (is|does|do|are|can)|which repo|find the)\b/, "asks where something lives"],
    ["unblock", /\b(fail(s|ed|ing)?|error|broken|can't|cannot|won't|stuck|blocked|exceeded|declined|loops?|crash\w*|timeout|times out|keeps? (growing|failing|getting))\b/, "describes something failing"],
    ["how_works", /\b(how (do|does|is|are|should|can)|understand|convention|explain|what is)\b/, "asks how something works"],
  ];
  for (const [kind, re, why] of rules) if (re.test(t)) return { kind, why };
  return { kind: "unblock", why: "no wording matched, so the default" };
}

export function detectUrgency(text: string): AskUrgency | null {
  const t = text.toLowerCase();
  if (/\b(asap|urgent|right now|production is down|outage|customers? (are|is) (affected|blocked)|blocked now)\b/.test(t)) return "blocked_now";
  if (/\b(today|by eod|end of day|this afternoon|before standup)\b/.test(t)) return "blocked_today";
  if (/\b(curious|wondering|no rush|when you have time|before my first|understand the convention)\b/.test(t)) return "curious";
  return null;
}

export function detectArtifacts(text: string): Array<{ kind: ArtifactKind; text: string }> {
  const out: Array<{ kind: ArtifactKind; text: string }> = [];
  const add = (kind: ArtifactKind, s: string) => {
    const v = s.trim();
    if (v && !out.some((a) => a.text.toLowerCase() === v.toLowerCase())) out.push({ kind, text: v.slice(0, 200) });
  };
  for (const m of text.matchAll(/https?:\/\/[^\s)"']+/g)) add("link", m[0]);
  for (const m of text.matchAll(/\b(?:ferndale|github\.com\/[\w.-]+)\/[\w.-]+/g)) add("repo", m[0]);
  for (const m of text.matchAll(/["“`]([^"”`\n]{6,160})["”`]/g)) add("error", m[1]);
  for (const m of text.matchAll(/\b[A-Z][A-Za-z]+(?:Error|Exception)\b|\bOOMKilled\b|\bHTTP [45]\d\d\b/g)) add("error", m[0]);
  for (const m of text.matchAll(/\b(?:[A-Za-z][\w-]*\s+){0,2}(?:dashboard|panel)\b/gi)) add("dashboard", m[0]);
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,9}-\d+\b|\bticket\s+#?\d+\b/g)) add("ticket", m[0]);
  return out;
}

const SENSITIVE_RULES: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "email address"],
  [/\+?\d[\d ()-]{8,}\d/g, "phone number"],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{6,}\b|\bAKIA[0-9A-Z]{16}\b/g, "credential"],
  [/\b(?:password|passwd|token|secret|api key)\s*(?:is|=|:)\s*\S+/gi, "credential"],
];
const PERSONAL = /\b(medical|doctor|therapy|therapist|pregnan\w*|diagnos\w*|sick leave|disability|salary|compensation|visa|immigration|lawsuit|harass\w*|divorce|grievance|performance review|layoff|fired)\b/i;

/** Spans that should stay out of a drafted message. The sentence is kept whole for personal matters. */
export function detectSensitive(text: string): Array<{ text: string; why: string }> {
  const out: Array<{ text: string; why: string }> = [];
  for (const [re, why] of SENSITIVE_RULES) for (const m of text.matchAll(re)) if (!out.some((s) => s.text === m[0])) out.push({ text: m[0], why });
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const hit = sentence.match(PERSONAL);
    if (hit && sentence.trim()) out.push({ text: sentence.trim(), why: `personal or HR matter (${hit[0].toLowerCase()})` });
  }
  return out;
}

const RESTATE: Record<HelpKind, (subject: string) => string> = {
  where_is: (s) => `You are looking for where something lives in ${s}`,
  how_works: (s) => `You want to understand how ${s} works`,
  is_expected: (s) => `You want to know whether what you see in ${s} is expected`,
  unblock: (s) => `You are stuck on ${s} and need someone to unblock you`,
  who_decides: (s) => `You need to know who decides about ${s}`,
};

function listWords(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Deterministic understanding from the catalog's names. Returns the model contract plus why each choice was made. */
export function extractByKeywords(text: string, catalog: Catalog): { output: ModelUnderstand; reasons: string[] } {
  const services = matchServices(text, catalog);
  const inferred = services.length ? null : inferService(text, catalog);
  if (inferred) services.push(inferred.ref);
  const skills = matchSkills(text, catalog);
  const help = detectHelpKind(text);
  const urgency = detectUrgency(text);
  const artifacts = detectArtifacts(text);
  const sensitive = detectSensitive(text);
  const first = text.split(/(?<=[.!?])\s+|\n/)[0].trim().replace(/[.!?]+$/, "");
  const firstShort = first.length > 90 ? `${first.slice(0, 87).trimEnd()}...` : first;
  const subject = services.length ? listWords(services.slice(0, 3).map((s) => s.name)) : skills.length ? listWords(skills.slice(0, 2).map((s) => s.name)) : null;
  const errorArt = artifacts.find((a) => a.kind === "error");
  // With nothing recognised, quote the asker rather than say "this"; sensitive text never goes in.
  const quoteOk = !sensitive.some((x) => first.includes(x.text) || x.text.includes(first));
  const restatement = subject
    ? `${RESTATE[help.kind](subject)}${errorArt ? `, starting from "${errorArt.text}"` : quoteOk && firstShort.length >= 8 ? `: "${firstShort}"` : ""}.`
    : quoteOk && firstShort.length >= 8
      ? `${RESTATE[help.kind]("something you described")}: "${firstShort}".`
      : `${RESTATE[help.kind]("something you described")}.`;
  return {
    output: { restatement, serviceIds: services.map((s) => s.id), skillIds: skills.map((s) => s.id), artifacts, helpKind: help.kind, urgency, sensitive },
    reasons: [
      `services: ${services.map((s) => `${s.id} ("${s.matched}")`).join(", ") || "none named, none inferred"}${inferred ? ` (inferred, runner-up ${inferred.runnerUp.toFixed(2)})` : ""}`,
      `skills by name or alias: ${skills.map((s) => `${s.id} ("${s.matched}")`).join(", ") || "none"}`,
      `help kind ${help.kind}: ${help.why}`,
      `urgency ${urgency ?? "not stated"}`,
      `${artifacts.length} artifacts, ${sensitive.length} sensitive spans`,
    ],
  };
}
