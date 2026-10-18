import "server-only";
// Every kind of model call the app makes, by name. callModel({ purpose }) looks the spec up here.
// To add one: write a PurposeSpec, add its model to MODEL_PRICES (src/lib/model-log.ts), and
// commit its demo fixture under fixtures/demo/ so demo mode looks identical to live mode. A purpose
// a user can trigger also gets key() and a file in fixtures/model/ (src/lib/model-fixtures.ts), so
// pnpm fixtures:record can store real live answers that demo mode replays.

import gateCheckFixture from "../../fixtures/demo/gate_check.json";
import draftFixtureFile from "../../fixtures/demo/draft_ask.json";
import explainFixtureFile from "../../fixtures/demo/explain_ranking.json";
import understandFixtureFile from "../../fixtures/demo/understand_ask.json";
import rampFixtureFile from "../../fixtures/demo/ramp_plan.json";
import { CALL_MINUTES, type DraftInput, type DraftOutput, type DraftText, type DraftVariant, DRAFT_VARIANTS, firstPerson, WORD_LIMIT } from "./draft";
import type { PurposeSpec } from "./model";
import { RAMP_LEARN_MAX, RAMP_LEARN_MIN } from "./ramp-types";
import { type Catalog, extractByKeywords, MODEL_UNDERSTAND_JSON_SCHEMA, type ModelUnderstand, ModelUnderstandSchema } from "./understanding";

const CHEAP_MODEL = "claude-haiku-5-5";

/** One sentence round trip, used by the "Run a gate check" button on /admin/usage. */
const gateCheck: PurposeSpec<Record<string, never>, { reply: string }> = {
  request: () => ({
    model: CHEAP_MODEL,
    system: "You are a health check. Reply with one short plain sentence saying you are reachable. Do not use em dashes or en dashes.",
    prompt: "Are you reachable?",
    maxTokens: 200,
    effort: "low",
    timeoutMs: 30_000,
  }),
  parse: (text) => {
    const reply = text.trim();
    if (!reply) throw new Error("empty reply");
    return { reply };
  },
  fixture: () => gateCheckFixture.output,
};

export type FixtureTextInput = { batch: string; system: string; instructions: string; items: Array<{ id: string; facts: string }> };

/** Rewrites seed text once for fixtures/company.json (scripts/generate-fixture.ts). No demo fixture: templates stay. */
const fixtureText: PurposeSpec<FixtureTextInput, Array<{ id: string; text: string }>> = {
  describe: (i) => i.batch,
  request: (i) => ({
    model: CHEAP_MODEL,
    system: i.system,
    prompt: `${i.instructions}\n\nItems:\n${JSON.stringify(i.items)}`,
    maxTokens: 16_000,
    effort: "low",
    timeoutMs: 10 * 60_000,
    jsonSchema: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: false },
    },
  }),
  parse: (text) => {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("model output is not a JSON array");
    return parsed.flatMap((row) => {
      const r = row as { id?: unknown; text?: unknown };
      return typeof r.id === "string" && typeof r.text === "string" ? [{ id: r.id, text: r.text }] : [];
    });
  },
  fixture: () => null,
};

export type UnderstandInput = { askId: string; text: string; catalog: Catalog };

/**
 * The demo result for an ask: the committed, hand-checked answer when the ask is one of the
 * composer examples (matched by the start of its text), otherwise the keyword extractor. Both are
 * deterministic and need no network, so demo mode always has an answer.
 */
export function understandFixture(input: UnderstandInput): { output: ModelUnderstand; via: "fixture" | "keywords"; detail: string } {
  const text = input.text.trim();
  const hit = understandFixtureFile.examples.find((e) => text.startsWith(e.bodyStartsWith));
  if (hit) {
    const parsed = ModelUnderstandSchema.safeParse(hit.output);
    if (parsed.success) return { output: parsed.data, via: "fixture", detail: `committed example "${hit.exampleId}"` };
    // A broken committed fixture must not break the demo: fall through to keywords, loudly.
    return { ...keywordFixture(input), detail: `committed example "${hit.exampleId}" failed validation (${parsed.error.issues[0]?.message}), used keywords` };
  }
  return keywordFixture(input);
}

function keywordFixture(input: UnderstandInput) {
  const k = extractByKeywords(input.text, input.catalog);
  return { output: k.output, via: "keywords" as const, detail: k.reasons.join("; ") };
}

/** Reads a new hire's ask into strict JSON: services, skills, artifacts, kind of help, urgency, sensitive spans. */
const understandAsk: PurposeSpec<UnderstandInput, ModelUnderstand> = {
  describe: (i) => i.askId,
  // The words of the ask and which services and skills exist; not the ask id.
  key: (i) => ({ text: i.text, services: i.catalog.services.map((s) => s.id).sort(), skills: i.catalog.skills.map((s) => s.id).sort() }),
  request: (i) => ({
    model: CHEAP_MODEL,
    system: [
      "You read a question a new hire at Ferndale Systems (freight software) typed, and return strict JSON describing it.",
      "Rules:",
      "- restatement: one plain sentence in the second person (\"You ...\") saying what they need. No names of people, nothing from the sensitive list, no em dashes or en dashes.",
      "- serviceIds and skillIds: only ids from the catalog below. Include a service when the question is about it even if they did not use its exact name. Never invent ids.",
      "- artifacts: things they mention that a helper would want to see: repo, error (the exact error text), dashboard, ticket, link, other. Copy the text exactly.",
      "- helpKind: where_is (where something lives), how_works (how something works), is_expected (is this behaviour normal), unblock (something fails and they are stuck), who_decides (a decision or approval).",
      "- urgency: blocked_now, blocked_today or curious if the text says so, otherwise null.",
      "- sensitive: exact substrings that should stay out of a message to a colleague: credentials, personal contact details, health, pay, immigration, HR or legal matters, customer personal data. Empty when there are none.",
    ].join("\n"),
    prompt: `Catalog of services (id: name, repo, what it does):\n${i.catalog.services.map((s) => `${s.id}: ${s.name}, ${s.repo}, ${s.description ?? ""}`).join("\n")}\n\nCatalog of skills (id: name, other words):\n${i.catalog.skills.map((s) => `${s.id}: ${s.name}${s.aliases.length ? ` (${s.aliases.join(", ")})` : ""}`).join("\n")}\n\nThe question:\n<question>\n${i.text}\n</question>`,
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 30_000,
    jsonSchema: MODEL_UNDERSTAND_JSON_SCHEMA as unknown as Record<string, unknown>,
  }),
  parse: (text) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`understand_ask output is not JSON: ${(err as Error).message}`);
    }
    const r = ModelUnderstandSchema.safeParse(raw);
    if (!r.success) throw new Error(`understand_ask output failed validation: ${r.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    return r.data;
  },
  fixture: (i) => understandFixture(i).output,
};

/** One person on the shortlist as the explainer sees them: evidence and score breakdown, nothing else. */
export type ExplainPerson = {
  id: string;
  firstName: string;
  /** Evidence sentences from retrieval, strongest first. */
  evidence: string[];
  /** Score components with their contribution, biggest first. */
  components: Array<{ key: string; label: string; points: number; detail: string }>;
  load: { count: number; max: number };
};
export type ExplainInput = { askId: string; people: ExplainPerson[] };
export type ExplainOutput = Array<{ id: string; reason: string }>;

/** Everything a reason for this person may say. The fact check (src/lib/explain-check.ts) reads the same list. */
export function explainFacts(p: ExplainPerson): string[] {
  return [p.firstName, ...p.evidence, ...p.components.map((c) => `${c.label}: ${c.detail} (${c.points >= 0 ? "+" : ""}${c.points} points)`)];
}

const stripPeriod = (s: string) => s.trim().replace(/[.]+$/, "");

/**
 * The demo reason for one person: their strongest evidence sentence, led by their first name, plus
 * one reachability fact (room this week, or the next free time). Only words from their own facts
 * and the connectives in fixtures/demo/explain_ranking.json, so it passes the same fact check.
 */
export function demoReason(p: ExplainPerson): string {
  const f = explainFixtureFile;
  const lead = stripPeriod(p.evidence[0] ?? p.components[0]?.detail ?? "came up in the search");
  const ownerLead = Object.entries(f.ownerLeads).find(([k]) => lead.startsWith(k));
  const head = ownerLead
    ? `${p.firstName} ${ownerLead[1]}${lead.slice(ownerLead[0].length)}`
    : f.verbLeads.some((v) => lead.startsWith(`${v} `))
      ? `${p.firstName} ${lead[0].toLowerCase()}${lead.slice(1)}`
      : `${p.firstName}: ${lead}`;
  const load = p.components.find((c) => c.key === "loadPenalty");
  const avail = p.components.find((c) => c.key === "availability");
  const roomy = p.load.max > 0 && p.load.count / p.load.max < f.roomBelowShare;
  const tail = roomy && load ? f.tails.room.replace("{detail}", load.detail) : avail && avail.detail.startsWith("free ") ? f.tails.free.replace("{detail}", avail.detail) : f.tails.none;
  return `${head}${tail ? `, ${tail}` : ""}.`;
}

/** One short reason per shortlisted person, written only from their evidence and score breakdown. */
const explainRanking: PurposeSpec<ExplainInput, ExplainOutput> = {
  describe: (i) => `${i.askId} (${i.people.length} people)`,
  key: (i) => ({ people: i.people }),
  request: (i) => ({
    model: CHEAP_MODEL,
    system: [
      "You write the one-line reason shown next to each colleague on a new hire's shortlist at Ferndale Systems.",
      "The ranking was already decided by code. You do not choose, reorder or judge anyone; you only explain.",
      "Rules:",
      "- One sentence per person, at most 30 words, starting with their first name.",
      "- State facts from that person's evidence and breakdown below and nothing else. Do not add numbers, names, services, tools, dates or times that are not written there.",
      "- Prefer the strongest evidence (ownership, recent work) and one fact about how reachable they are (free time or room this week).",
      "- Refer to the person by first name or \"they\". Never use he, she, him or her.",
      "- Plain words. No em dashes or en dashes, no superlatives, no \"best\".",
    ].join("\n"),
    prompt: `People:\n${i.people
      .map((p) => `<person id="${p.id}" first_name="${p.firstName}">\nEvidence:\n${p.evidence.map((e) => `- ${e}`).join("\n")}\nBreakdown:\n${p.components.map((c) => `- ${c.label}: ${c.detail} (${c.points >= 0 ? "+" : ""}${c.points} points)`).join("\n")}\n</person>`)
      .join("\n")}`,
    maxTokens: 1200,
    effort: "low",
    timeoutMs: 30_000,
    jsonSchema: {
      type: "object",
      properties: { reasons: { type: "array", items: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"], additionalProperties: false } } },
      required: ["reasons"],
      additionalProperties: false,
    },
  }),
  parse: (text, input) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`explain_ranking output is not JSON: ${(err as Error).message}`);
    }
    const reasons = (raw as { reasons?: unknown }).reasons;
    if (!Array.isArray(reasons)) throw new Error("explain_ranking output has no reasons array");
    const ids = new Set(input.people.map((p) => p.id));
    return reasons.flatMap((r) => {
      const x = r as { id?: unknown; reason?: unknown };
      return typeof x.id === "string" && typeof x.reason === "string" && ids.has(x.id) ? [{ id: x.id, reason: x.reason }] : [];
    });
  },
  fixture: (i) => i.people.map((p) => ({ id: p.id, reason: demoReason(p) })),
};

// ---------------------------------------------------------------------------
// draft_ask: the three message variants
// ---------------------------------------------------------------------------

const endWithPeriod = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const firstSentence = (s: string) => (s.split(/(?<=[.!?])\s+/)[0] ?? s).trim();

/** "Owns billing-service (ferndale/billing-service) and answered ..." as "you own billing-service". */
export function evidenceAsReason(evidence: string | undefined): string {
  const f = draftFixtureFile;
  if (!evidence) return f.whyFallback;
  let e = evidence.trim().replace(/[.]+$/, "");
  for (const cut of f.evidenceCuts) {
    const i = e.indexOf(cut);
    if (i > 0) e = e.slice(0, i);
  }
  const lead = f.evidenceLeads.find(([from]) => e.startsWith(from));
  return lead ? `${lead[1]}${e.slice(lead[0].length)}` : f.whyFallback;
}

/**
 * The demo drafts for one input, from the committed lines in fixtures/demo/draft_ask.json. Every
 * filled value comes from the input, so the same grounding check passes. Deterministic.
 */
export function demoDraft(i: DraftInput): DraftOutput {
  const f = draftFixtureFile;
  const topic = i.question.services[0] ?? i.question.skills[0] ?? null;
  const tried = i.tried ? endWithPeriod(i.tried) : null;
  const askKey = i.channel.recommended === "async" ? (`async_${i.urgency.key}` as const) : i.channel.recommended;
  const asks = (f.asks as Record<string, { short: string; full: string }>)[askKey] ?? f.asks.async_blocked_today;
  const vars: Record<string, string | null> = {
    first: i.recipient.firstName,
    about: topic ? ` about ${topic}` : "",
    question: endWithPeriod(firstPerson(i.question.restatement)),
    triedShort: tried ? f.tried.short.replace("{tried}", tried) : null,
    triedFull: tried ?? f.tried.fullNone,
    askShort: asks.short,
    askFull: asks.full,
    askerFirst: i.asker.firstName,
    askerTitle: i.asker.title,
    askerTeam: i.asker.team,
    daysIn: i.asker.daysIn !== null ? `, ${i.asker.daysIn} days in` : "",
    why: evidenceAsReason(i.why.evidence[0]),
    focus: i.asker.focus ? endWithPeriod(firstSentence(i.asker.focus)) : null,
    urgencyLower: i.urgency.label.toLowerCase(),
    slotAsk: i.slot ? f.slotAsk.slot.replace("{slot}", i.slot.label) : f.slotAsk.none,
  };
  const fill = (line: string): string | null => {
    let missing = false;
    const out = line.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vars[k];
      if (v === null || v === undefined) missing = true;
      return v ?? "";
    });
    return missing ? null : out;
  };
  const build = (v: { subject: string; lines: string[] }): DraftText => ({
    subject: fill(v.subject) ?? "",
    body: v.lines
      .map(fill)
      .filter((x): x is string => x !== null)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  });
  return { short: build(f.short), full: build(f.full), call: build(f.call) };
}

const draftText = { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false };

/** Three versions of the message the asker will send themselves. Written only from the input. */
const draftAsk: PurposeSpec<DraftInput, DraftOutput> = {
  describe: (i) => `${i.askId} to ${i.recipient.id}`,
  key: ({ askId: _askId, ...rest }) => rest,
  request: (i) => ({
    model: CHEAP_MODEL,
    system: [
      "You draft a message a new hire at Ferndale Systems (freight software) will send to one colleague. The new hire sends it themselves; you only write it.",
      "Write three versions as JSON: short, full and call. Each has a subject (an email subject or calendar invite title) and a body.",
      "Grounding rules, these matter most:",
      "- Use only facts in the input below. Never mention a service, repo, project, person, tool, number, date or time that is not written there.",
      "- Do not invent anything about the asker's work, team or history beyond the input. If the input does not say it, leave it out.",
      "- Write in the first person as the asker. The restatement is written to the asker (\"You want ...\"); turn it into the asker's own words.",
      "- Address the recipient by first name. Refer to anyone else by name only if the input names them. Never use he, she, him or her.",
      "Versions:",
      "- short: at most four lines, for a peer: the question, what was tried, what you need from them.",
      "- full: for someone senior who must decide fast whether to engage. Short labelled parts: what I am doing, what I tried, my question, what I am asking for (the specific ask of their time, matching the recommended channel).",
      `- call: ask for the exact ${CALL_MINUTES} minute slot given in the input (if there is none, ask for ${CALL_MINUTES} minutes in the next few days), and state the question up front so they can answer in text instead if that is quicker.`,
      `Style: plain words, no greetings beyond "Hi <first name>", no flattery, no emoji, no em dashes or en dashes. Keep each body under ${WORD_LIMIT} words; short under 60.`,
    ].join("\n"),
    prompt: `Input (JSON):\n<draft_input>\n${JSON.stringify(i, null, 2)}\n</draft_input>`,
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 30_000,
    jsonSchema: {
      type: "object",
      properties: { short: draftText, full: draftText, call: draftText },
      required: [...DRAFT_VARIANTS],
      additionalProperties: false,
    },
  }),
  parse: (text) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`draft_ask output is not JSON: ${(err as Error).message}`);
    }
    const out = {} as DraftOutput;
    for (const v of DRAFT_VARIANTS as readonly DraftVariant[]) {
      const x = (raw as Record<string, { subject?: unknown; body?: unknown }>)[v];
      if (!x || typeof x.body !== "string" || !x.body.trim()) throw new Error(`draft_ask output has no ${v} body`);
      out[v] = { subject: typeof x.subject === "string" ? x.subject : "", body: x.body };
    }
    return out;
  },
  fixture: (i) => demoDraft(i),
};

// ---------------------------------------------------------------------------
// ramp_plan: the weekly ramp plan
// ---------------------------------------------------------------------------

/** One pool entry as the model sees it: a ref to pick and the only facts it may use. */
export type RampPoolItem = { ref: string; kind: "document" | "employee" | "project"; title: string; skill: string | null; facts: string[]; meta: Record<string, string> };
export type RampInput = {
  owner: string;
  weekStart: string;
  asker: { firstName: string; team: string; daysIn: number | null };
  gaps: Array<{ skillId: string; name: string; signals: string[] }>;
  learn: RampPoolItem[];
  stretch: RampPoolItem[];
  meet: RampPoolItem[];
};
export type RampOutput = { learn: Array<{ ref: string; why: string }>; stretch: { ref: string; task: string; why: string } | null; meet: { ref: string; why: string } | null };

/** Words the demo lines add around the facts. The fact check (src/lib/ramp.ts) accepts them too. */
export const RAMP_CONNECTIVES: string[] = [
  ...Object.values(rampFixtureFile.learn),
  ...Object.values(rampFixtureFile.stretch),
  ...Object.values(rampFixtureFile.meet),
].map((l) => l.replace(/\{\w+\}/g, " "));

const fillLine = (line: string, vars: Record<string, string | undefined>) => line.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "").replace(/\s+([,.])/g, "$1").replace(/\.\./g, ".");

/** The demo plan: the top of each pool, one learn item per gap first, sentences from the committed lines. */
export function demoRampPlan(i: RampInput): RampOutput {
  const f = rampFixtureFile;
  const signalFor = (skill: string | null) => stripPeriod(i.gaps.find((g) => g.name === skill)?.signals[0] ?? i.gaps[0]?.signals[0] ?? "");
  // One item per gap, alternating document and colleague (gap 1 a document, gap 2 a person, ...).
  const picked: RampPoolItem[] = [];
  i.gaps.forEach((g, k) => {
    const want = k % 2 === 0 ? "document" : "employee";
    const forGap = i.learn.filter((c) => c.skill === g.name && !picked.includes(c));
    const hit = forGap.find((c) => c.kind === want) ?? forGap[0];
    if (hit && picked.length < RAMP_LEARN_MAX) picked.push(hit);
  });
  for (const c of i.learn) if (picked.length < RAMP_LEARN_MIN && !picked.includes(c)) picked.push(c);
  const learn = picked.map((c) => ({
    ref: c.ref,
    why: fillLine(c.kind === "document" ? f.learn.document : f.learn.employee, { ...c.meta, signal: signalFor(c.skill), title: c.title, fact: stripPeriod(c.facts[0] ?? ""), fact2: stripPeriod(c.facts[1] ?? c.facts[0] ?? "") }),
  }));
  const s = i.stretch[0];
  const stretch = s
    ? {
        ref: s.ref,
        task: fillLine(s.meta.lead ? f.stretch.taskWithLead : f.stretch.taskNoLead, { lead: s.meta.lead, title: s.title, skillPart: s.meta.skill ? fillLine(f.stretch.skillPart, { skill: s.meta.skill }) : "" }),
        why: fillLine(f.stretch.why, { fact: stripPeriod(s.facts[0] ?? "") }),
      }
    : null;
  const m = i.meet[0];
  const meet = m ? { ref: m.ref, why: fillLine(f.meet.why, { fact2: stripPeriod(m.facts[1] ?? m.facts[0] ?? "") }) } : null;
  return { learn, stretch, meet };
}

const rampPick = { type: "object", properties: { ref: { type: "string" }, why: { type: "string" } }, required: ["ref", "why"], additionalProperties: false };

/** Picks from pools decided by code and writes one or two sentences per item, from their facts only. */
const rampPlan: PurposeSpec<RampInput, RampOutput> = {
  describe: (i) => `${i.owner} week ${i.weekStart}`,
  // Everything the plan is made from except whose plan it is (the owner id changes per account).
  key: ({ owner: _owner, ...rest }) => rest,
  request: (i) => ({
    model: CHEAP_MODEL,
    system: [
      "You write a new hire's weekly ramp plan at Ferndale Systems (freight software). Code already found their skill gaps from their own asks and chose short pools of real documents, colleagues and projects. You pick from the pools and write the sentences.",
      "Rules:",
      `- learn: pick ${RAMP_LEARN_MIN} or ${RAMP_LEARN_MAX} refs from the learn pool, covering different gaps when you can. stretch: one ref from the stretch pool, or null if it is empty. meet: one ref from the meet pool, or null if it is empty.`,
      "- why: one or two short sentences saying why this item, for this person, this week. Use only the item's facts and the gap signals. Do not add names, numbers, services, tools, dates or ask ids that are not written there.",
      "- stretch task: one sentence, a concrete piece of work drawn from the project's own description, small enough for one week.",
      "- No generic career advice, no encouragement, no superlatives. Refer to colleagues by name or \"they\", never he, she, him or her. Address the new hire as \"you\". No em dashes or en dashes.",
    ].join("\n"),
    prompt: `Input (JSON):\n<ramp_input>\n${JSON.stringify({ asker: i.asker, gaps: i.gaps, learn: i.learn.map(({ meta: _m, ...x }) => x), stretch: i.stretch.map(({ meta: _m, ...x }) => x), meet: i.meet.map(({ meta: _m, ...x }) => x) }, null, 2)}\n</ramp_input>`,
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 30_000,
    jsonSchema: {
      type: "object",
      properties: {
        learn: { type: "array", items: rampPick },
        stretch: { anyOf: [{ type: "object", properties: { ref: { type: "string" }, task: { type: "string" }, why: { type: "string" } }, required: ["ref", "task", "why"], additionalProperties: false }, { type: "null" }] },
        meet: { anyOf: [rampPick, { type: "null" }] },
      },
      required: ["learn", "stretch", "meet"],
      additionalProperties: false,
    },
  }),
  parse: (text, input) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`ramp_plan output is not JSON: ${(err as Error).message}`);
    }
    const r = raw as { learn?: unknown; stretch?: unknown; meet?: unknown };
    const inPool = (pool: RampPoolItem[], ref: unknown) => typeof ref === "string" && pool.some((c) => c.ref === ref);
    const learn = (Array.isArray(r.learn) ? r.learn : []).flatMap((x) => {
      const y = x as { ref?: unknown; why?: unknown };
      return inPool(input.learn, y.ref) && typeof y.why === "string" ? [{ ref: y.ref as string, why: y.why }] : [];
    });
    const uniq = learn.filter((x, k) => learn.findIndex((y) => y.ref === x.ref) === k).slice(0, RAMP_LEARN_MAX);
    if (input.learn.length >= RAMP_LEARN_MIN && uniq.length < RAMP_LEARN_MIN) throw new Error(`ramp_plan picked ${uniq.length} learn items from the pool, needs ${RAMP_LEARN_MIN}`);
    const st = r.stretch as { ref?: unknown; task?: unknown; why?: unknown } | null;
    const stretch = st && inPool(input.stretch, st.ref) && typeof st.task === "string" && typeof st.why === "string" ? { ref: st.ref as string, task: st.task, why: st.why } : null;
    const me = r.meet as { ref?: unknown; why?: unknown } | null;
    const meet = me && inPool(input.meet, me.ref) && typeof me.why === "string" ? { ref: me.ref as string, why: me.why } : null;
    if (input.stretch.length && !stretch) throw new Error("ramp_plan gave no valid stretch ref although the pool is not empty");
    if (input.meet.length && !meet) throw new Error("ramp_plan gave no valid meet ref although the pool is not empty");
    return { learn: uniq, stretch, meet };
  },
  fixture: (i) => demoRampPlan(i),
};

export const PURPOSES = {
  gate_check: gateCheck,
  understand_ask: understandAsk,
  explain_ranking: explainRanking,
  draft_ask: draftAsk,
  ramp_plan: rampPlan,
  fixture_text: fixtureText,
};

export type PurposeName = keyof typeof PURPOSES;
