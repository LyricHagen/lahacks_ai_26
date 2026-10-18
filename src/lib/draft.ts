// The message draft, defined once: the three variants, the formats they render in, the input the
// drafting step builds, and the grounding check every draft passes before anyone sees it. No
// server imports: the draft editor (client) counts words and builds the copied text with the same
// functions the server uses.
//
// Who2Ask never sends anything. It drafts, the asker edits, the asker sends it from their own
// Slack, mail or calendar, then says so with "I sent this".

export const DRAFT_VARIANTS = ["short", "full", "call"] as const;
export type DraftVariant = (typeof DRAFT_VARIANTS)[number];

export const VARIANT_DEF: Record<DraftVariant, { label: string; forWhom: string; shape: string }> = {
  short: { label: "Short", forWhom: "For a peer", shape: "Four lines: the question, what you tried, what you need." },
  full: {
    label: "Full context",
    forWhom: "For someone senior",
    shape: "What you are doing, what you tried, the specific question and the specific ask of their time, so they can decide fast whether to engage.",
  },
  call: { label: "Call request", forWhom: "When talking is faster", shape: "One 15 minute slot from their calendar, with the question up front so they can answer in text instead." },
};

export function isDraftVariant(v: unknown): v is DraftVariant {
  return typeof v === "string" && (DRAFT_VARIANTS as readonly string[]).includes(v);
}

/** How the draft is shown: the format of the channel the asker will paste it into. */
export const DRAFT_FORMATS = ["slack", "email", "invite"] as const;
export type DraftFormat = (typeof DRAFT_FORMATS)[number];
export const FORMAT_LABEL: Record<DraftFormat, string> = { slack: "Slack DM", email: "Email", invite: "Calendar invite" };
/** Where the asker sends it from, for the step list ("Paste it into Slack"). */
export const FORMAT_APP: Record<DraftFormat, string> = { slack: "Slack", email: "your mail app", invite: "your calendar" };

export function isDraftFormat(v: unknown): v is DraftFormat {
  return typeof v === "string" && (DRAFT_FORMATS as readonly string[]).includes(v);
}

/** Long asks get ignored: past this the editor shows a plain warning. */
export const WORD_LIMIT = 120;
export const SUBJECT_MAX = 140;
export const BODY_MAX = 4000;
/** The "They answered" line. */
export const ANSWER_NOTE_MAX = 280;
export const CALL_MINUTES = 15;

export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/** Exactly what the Copy button puts on the clipboard: the fields on screen, in screen order. */
export function copyText(format: DraftFormat, subject: string, body: string, when: string | null): string {
  const b = body.trim();
  if (format === "slack") return b;
  if (format === "email") return subject.trim() ? `Subject: ${subject.trim()}\n\n${b}` : b;
  return [subject.trim(), when ? `When: ${when}` : null, "", b].filter((x) => x !== null).join("\n").trim();
}

// ---------------------------------------------------------------------------
// the input: everything a draft may say, and nothing else
// ---------------------------------------------------------------------------

export type Relationship = {
  /** same_team, manager, report, manager_chain, mentor, same_department, other_team */
  kind: string;
  /** peer, more_senior, much_more_senior, more_junior */
  seniority: string;
  levelsAbove: number;
  /** One plain sentence for the model and the page ("Sophia is on Payments, another team in Engineering, ..."). */
  sentence: string;
};

export type DraftInput = {
  askId: string;
  asker: { firstName: string; title: string; team: string; daysIn: number | null; zone: string; focus: string | null };
  recipient: { id: string; firstName: string; name: string; title: string; team: string; slackHandle: string; email: string; zone: string };
  relationship: Relationship;
  question: {
    /** In the second person, as confirmed by the asker ("You want to find ..."). */
    restatement: string;
    helpKind: string;
    services: string[];
    skills: string[];
    /** Things the asker mentioned (error text, repo, dashboard), sensitive ones removed. */
    mentioned: string[];
  };
  /** What the asker already tried, sensitive sentences removed. Null when they said nothing. */
  tried: string | null;
  urgency: { key: string; label: string };
  /** Why this person: their strongest evidence sentences and the shortlist reason. */
  why: { evidence: string[]; reason: string | null };
  channel: { recommended: "call" | "dm" | "async"; rule: string; headline: string; format: DraftFormat };
  /** The 15 minute slot from the availability engine, for the call request. */
  slot: { start: string; end: string; label: string; soft: boolean } | null;
};

export type DraftText = { subject: string; body: string };
export type DraftOutput = Record<DraftVariant, DraftText>;

/** Every string in the input, for the grounding check: a name in the draft must appear here. */
export function inputCorpus(i: DraftInput): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(i);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// the grounding check
// ---------------------------------------------------------------------------

/** A name the draft may only use when the input has it: a service, repo, project or person. */
export type KnownName = { kind: "service" | "repo" | "project" | "person"; name: string; caseSensitive: boolean };

export type StrippedSentence = { field: "subject" | "body"; sentence: string; why: string; names: string[] };
export type GroundingResult = { ok: boolean; text: DraftText; stripped: StrippedSentence[]; checkedNames: number };

/** Single word service names that are ordinary words; only their repo form (ferndale/web) counts as a name. */
const COMMON_WORD_NAMES = new Set(["web", "warehouse", "observability"]);
/** First names that are also ordinary words at the start of a sentence. */
const COMMON_FIRST_NAMES = new Set(["Grace", "Ruth", "Rosa"]);

/** The names list from the company: services (and repos), projects, people (full and first names). */
export function knownNames(args: { services: Array<{ name: string; repo: string }>; projects: string[]; people: string[] }): KnownName[] {
  const out: KnownName[] = [];
  for (const s of args.services) {
    if (!COMMON_WORD_NAMES.has(s.name)) out.push({ kind: "service", name: s.name, caseSensitive: false });
    out.push({ kind: "repo", name: s.repo, caseSensitive: false });
  }
  for (const p of args.projects) out.push({ kind: "project", name: p, caseSensitive: false });
  const firsts = new Set<string>();
  for (const p of args.people) {
    out.push({ kind: "person", name: p, caseSensitive: true });
    const first = p.split(" ")[0];
    if (first && first !== p) firsts.add(first);
  }
  for (const f of firsts) out.push({ kind: "person", name: f, caseSensitive: true });
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, name: string, caseSensitive: boolean) => new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(name)}($|[^A-Za-z0-9_-])`, caseSensitive ? "" : "i").test(text);

/** Sentences of one line, keeping their punctuation. */
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter((s) => s.trim());
}

/**
 * Keep only sentences whose names are all in the input, and that contain none of the protected
 * strings (sensitive spans, the confidential note). Line breaks are kept, so the format survives.
 */
export function groundDraft(text: DraftText, corpus: string, names: KnownName[], protectedTexts: string[]): GroundingResult {
  const stripped: StrippedSentence[] = [];
  const guard = protectedTexts.map((p) => p.trim().toLowerCase()).filter((p) => p.length >= 3);
  const check = (field: "subject" | "body", sentence: string): boolean => {
    const lower = sentence.toLowerCase();
    if (guard.some((g) => lower.includes(g))) {
      stripped.push({ field, sentence: "[sensitive sentence, not shown]", why: "contains text the asker marked to leave out", names: [] });
      return false;
    }
    const unknown = names.filter((n) => {
      if (!has(sentence, n.name, n.caseSensitive)) return false;
      if (n.kind === "person" && COMMON_FIRST_NAMES.has(n.name) && sentence.trimStart().startsWith(n.name)) return false;
      return !has(corpus, n.name, false);
    });
    // A longer name already covers its first name ("Astrid Petrov" and "Astrid").
    const shown = unknown.filter((n) => !unknown.some((m) => m !== n && m.name.length > n.name.length && m.name.includes(n.name))).map((n) => `${n.kind} ${n.name}`);
    if (shown.length) {
      stripped.push({ field, sentence, why: "names something that is not in the input", names: shown });
      return false;
    }
    return true;
  };
  const subject = sentencesOf(text.subject.replace(/\s+/g, " ").trim())
    .filter((s) => check("subject", s))
    .join(" ");
  const lines = text.body.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      kept.push("");
      continue;
    }
    const parts = sentencesOf(line).filter((s) => check("body", s));
    if (parts.length) kept.push(parts.join(" "));
  }
  const body = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { ok: stripped.length === 0, text: { subject, body }, stripped, checkedNames: names.length };
}

/** Model text: the UI rules forbid em and en dashes, so they become commas. Line breaks survive. */
export function cleanDraftText(s: string): string {
  return s
    .replace(/[ \t]*[\u2014\u2013][ \t]*/g, ", ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** "You want to find where ..." as the asker would write it: "I want to find where ...". */
export function firstPerson(restatement: string): string {
  return restatement
    .trim()
    .replace(/\byou are\b/gi, "I am")
    .replace(/\byou're\b/gi, "I'm")
    .replace(/\byou've\b/gi, "I've")
    .replace(/\byourself\b/gi, "myself")
    .replace(/\byour\b/gi, "my")
    .replace(/^you\b/i, "I")
    .replace(/(?<=[.!?,;]\s+|\b(?:and|but|because|so|that|why|when|if)\s+)you\b/gi, "I")
    .replace(/\byou\b/gi, "me");
}
