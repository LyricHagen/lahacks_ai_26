// Scoring for the understand_ask eval. Pure: gold and predicted ModelUnderstand in, counts out.
//
// Entities are services, skills, artifacts and sensitive spans. Each is scored as a set:
//   services, skills   exact id match
//   artifacts          text match after normalizing case, quotes and edge punctuation, or one text
//                      containing the other; "other" artifacts are ignored on both sides (the gold
//                      never has them: they are paraphrases, not something that can be scored exactly)
//   sensitive          one span containing the other, case-insensitive (a model that flags
//                      "Fern12ab!" for gold "password is Fern12ab!" has caught the secret)
// Field F1 is micro-averaged over examples. helpKind and urgency are accuracy.

import type { ModelUnderstand } from "@/lib/understanding";

export type Counts = { tp: number; fp: number; fn: number };
export const ENTITY_FIELDS = ["services", "skills", "artifacts", "sensitive"] as const;
export type EntityField = (typeof ENTITY_FIELDS)[number];

export type ExampleScore = {
  valid: boolean;
  fields: Record<EntityField, Counts>;
  helpKind: boolean;
  urgency: boolean;
  /** Gold sensitive spans, and how many the prediction caught. */
  sensitiveGold: number;
  sensitiveHit: number;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^[\s"'`“”]+|[\s"'`“”.,;:!?]+$/g, "")
    .replace(/\s+/g, " ");

function matchSets<T>(gold: T[], pred: T[], same: (g: T, p: T) => boolean): Counts {
  const used = new Set<number>();
  let tp = 0;
  for (const g of gold) {
    const i = pred.findIndex((p, j) => !used.has(j) && same(g, p));
    if (i >= 0) {
      used.add(i);
      tp++;
    }
  }
  return { tp, fp: pred.length - used.size, fn: gold.length - tp };
}

const contains = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

export function scoreExample(gold: ModelUnderstand, pred: ModelUnderstand | null): ExampleScore {
  const p: ModelUnderstand = pred ?? { restatement: "", serviceIds: [], skillIds: [], artifacts: [], helpKind: "unblock", urgency: null, sensitive: [] };
  const uniq = (xs: string[]) => [...new Set(xs)];
  const goldArt = gold.artifacts.filter((a) => a.kind !== "other").map((a) => a.text);
  const predArt = p.artifacts.filter((a) => a.kind !== "other").map((a) => a.text);
  const sensitive = matchSets(gold.sensitive.map((s) => s.text), p.sensitive.map((s) => s.text), contains);
  return {
    valid: pred !== null,
    fields: {
      services: matchSets(uniq(gold.serviceIds), uniq(p.serviceIds), (a, b) => a === b),
      skills: matchSets(uniq(gold.skillIds), uniq(p.skillIds), (a, b) => a === b),
      artifacts: matchSets(goldArt, predArt, contains),
      sensitive,
    },
    helpKind: pred !== null && gold.helpKind === p.helpKind,
    urgency: pred !== null && gold.urgency === p.urgency,
    sensitiveGold: gold.sensitive.length,
    sensitiveHit: sensitive.tp,
  };
}

export const f1 = (c: Counts) => (c.tp === 0 ? (c.fp === 0 && c.fn === 0 ? 1 : 0) : (2 * c.tp) / (2 * c.tp + c.fp + c.fn));
export const add = (a: Counts, b: Counts): Counts => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn });
const zero = (): Counts => ({ tp: 0, fp: 0, fn: 0 });

export type Summary = {
  n: number;
  validity: number;
  entityF1: number;
  fieldF1: Record<EntityField, number>;
  helpKindAcc: number;
  urgencyAcc: number;
  sensitiveRecall: number;
  /** false positives: sensitive spans flagged where the gold had none at that place */
  sensitiveFp: number;
};

export function summarize(scores: ExampleScore[]): Summary {
  const fields = Object.fromEntries(ENTITY_FIELDS.map((f) => [f, scores.reduce((c, s) => add(c, s.fields[f]), zero())])) as Record<EntityField, Counts>;
  const all = ENTITY_FIELDS.reduce((c, f) => add(c, fields[f]), zero());
  const gold = scores.reduce((n, s) => n + s.sensitiveGold, 0);
  const hit = scores.reduce((n, s) => n + s.sensitiveHit, 0);
  const n = scores.length || 1;
  return {
    n: scores.length,
    validity: scores.filter((s) => s.valid).length / n,
    entityF1: f1(all),
    fieldF1: Object.fromEntries(ENTITY_FIELDS.map((f) => [f, f1(fields[f])])) as Record<EntityField, number>,
    helpKindAcc: scores.filter((s) => s.helpKind).length / n,
    urgencyAcc: scores.filter((s) => s.urgency).length / n,
    sensitiveRecall: gold ? hit / gold : 1,
    sensitiveFp: fields.sensitive.fp,
  };
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
