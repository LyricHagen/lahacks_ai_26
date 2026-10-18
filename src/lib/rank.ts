// Ranking: pure functions, no server imports, no model call. The server step
// (src/lib/ask-rank-step.ts) and the shortlist's tune control (client side) call the same
// rankCandidates, so the page re-ranks instantly from the stored components and gets exactly the
// answer the server logged.
//
// Each candidate gets eight components, each a raw value in 0..1 with a short detail fragment:
//
//   ownership     primary owner > backup owner > answered asks about it > worked on it > wrote a doc
//   skillMatch    proficiency times how we know it; a self-listed profile skill is discounted
//   recency       decay on the most recent dated work on the service or project
//   availability  next usable window inside the urgency horizon (src/lib/availability.ts); focus
//                 time counts as open only for someone blocked right now
//   mentorFit     is a mentor, past mentees, seniority distance from the asker
//   proximity     same team, manager chain, same department
//   timezone      working hours overlap with the asker
//   loadPenalty   asks routed to them in the last 7 days against max_weekly_asks, cubed; NEGATIVE
//
// score = sum(weight * raw) over the positive components minus weight * loadPenalty, clamped 0..100.
// Positive weights add up to 100. Every number lives in RANK_CONFIG so tuning happens in one place.
//
// Fairness guardrails run after scoring, and every one reports whether it fired and why:
//   hard_cap       at or over max_weekly_asks: excluded, shown with the reason (never silently dropped)
//   out_of_office  out of office for the whole urgency horizon: excluded, shown with the reason
//   cooldown       the same person was this asker's top suggestion in the last 24 hours: not #1 again
//                  unless nobody else clears the relevance floor
//   spread         the shortlist always holds at least one person who is not one of the obvious experts

import type { AskUrgency } from "./ask-state";
import type { Recommendation, WindowView } from "./availability-types";

export const COMPONENTS = ["ownership", "skillMatch", "recency", "availability", "mentorFit", "proximity", "timezone", "loadPenalty"] as const;
export type Component = (typeof COMPONENTS)[number];
export type PositiveComponent = Exclude<Component, "loadPenalty">;
export const POSITIVE_COMPONENTS = COMPONENTS.filter((c): c is PositiveComponent => c !== "loadPenalty");
/** The components that say how much someone knows, as opposed to how reachable they are. */
export const EXPERTISE_COMPONENTS = ["ownership", "skillMatch", "recency"] as const satisfies readonly PositiveComponent[];

export const COMPONENT_LABEL: Record<Component, string> = {
  ownership: "Ownership",
  skillMatch: "Skill match",
  recency: "Recency",
  availability: "Availability",
  mentorFit: "Mentor fit",
  proximity: "Proximity",
  timezone: "Time zone",
  loadPenalty: "Load penalty",
};

export const RANK_CONFIG = {
  version: "rank-v1",
  /** Positive weights add up to 100. loadPenalty is subtracted: weight times (load / max) cubed. */
  weights: { ownership: 32, skillMatch: 16, recency: 8, availability: 16, mentorFit: 10, proximity: 6, timezone: 12, loadPenalty: 30 } satisfies Record<Component, number>,
  /** Project roles come from project_members.role; answered means seeded asks about the service were routed to them. */
  ownership: { primary: 1, secondary: 0.8, answered: 0.55, lead: 0.55, contributor: 0.45, reviewer: 0.35, advisor: 0.35, author: 0.3 } as Record<string, number>,
  skill: {
    /** How much a proficiency counts by where we learned it. A self-listed profile skill is not real work. */
    sourceFactor: { owns_service: 1, project: 0.9, authored_doc: 0.8, team: 0.6, profile: 0.35 } as Record<string, number>,
    /** Skills the asker already knows count for less (from onboarding, or persona skills by default). */
    knownByAskerFactor: 0.5,
    /** When no skill row matches, a close profile embedding counts this much at most (self written). */
    profileSimilarityCap: 0.25,
  },
  recency: { halfLifeDays: 60 },
  availability: {
    /** Working days to look ahead, counted in the candidate's own zone. */
    horizonWorkingDays: { blocked_now: 1, blocked_today: 2, curious: 5 } satisfies Record<AskUrgency, number>,
    minSlotMinutes: { blocked_now: 15, blocked_today: 30, curious: 30 } satisfies Record<AskUrgency, number>,
    /** Free at the very end of the horizon still beats not free at all. */
    floorWhenFree: 0.15,
    /** availability = soonShare x (how soon the first window opens) + the rest x (how much of the horizon is open). */
    soonShare: 0.6,
    /** Open time at or above this share of the horizon counts as fully open. */
    openShareFull: 0.5,
    /** Used when the calendar has no data for the horizon (seed calendars cover 14 days). */
    unknown: 0.5,
    // Working hours and which calendar blocks count as busy live in AVAILABILITY_CONFIG (src/lib/availability.ts).
  },
  mentor: {
    isMentor: 0.5,
    perPastMentee: 0.15,
    maxPastMentees: 3,
    /** Fit by seniority gap from the asker (0 levels, 1, 2, 3, 4 or more): a peer is often the better ask. */
    seniorityGapFit: [1, 0.85, 0.55, 0.25, 0.05],
    /** Share of mentorFit that is seniority distance; bigger when the asker prefers peers first. */
    peerShare: { prefersPeers: 0.65, okToInterrupt: 0.35 },
  },
  proximity: { sameTeam: 1, managerChain: 0.7, sameDepartment: 0.35, other: 0 },
  /**
   * Overlap matters less the less urgent the ask: raw = 1 - (1 - overlap share) x factor. An ask
   * that can wait is answered asynchronously anyway.
   */
  timezone: { fullOverlapHours: 8.5, urgencyFactor: { blocked_now: 1, blocked_today: 0.6, curious: 0.3 } satisfies Record<AskUrgency, number> },
  load: { exponent: 3 },
  guardrails: {
    /** Below this relevance (expertise only, 0..1) someone is not a real alternative. */
    relevanceFloor: 0.25,
    cooldownHours: 24,
    /**
     * Obvious experts, the names a new hire hears first: owners of the service, anyone within this
     * share of the best relevance, and senior people within spreadSeniorShare of it.
     */
    spreadExpertShare: 0.8,
    spreadSeniorShare: 0.5,
    seniorLevels: ["senior", "staff", "principal", "manager", "director", "executive"],
  },
  shortlist: { min: 3, max: 5, /** After the first `min`, keep people scoring at least this share of #1. */ keepAboveShareOfTop: 0.6 },
  /**
   * The tune control: each multiplier is reached at the end of the slider (-1 expertise, +1 speed)
   * and blended linearly toward 1 at the middle. Positive weights are renormalised to 100.
   */
  tune: {
    expertise: { ownership: 1.6, skillMatch: 1.7, recency: 1.4, availability: 0.4, mentorFit: 0.7, proximity: 0.8, timezone: 0.5, loadPenalty: 0.8 },
    speed: { ownership: 0.55, skillMatch: 0.55, recency: 0.7, availability: 2.2, mentorFit: 1.2, proximity: 1.2, timezone: 1.8, loadPenalty: 1.4 },
  } satisfies Record<string, Record<Component, number>>,
} as const;

export const TUNE_STOPS = [
  { value: -1, label: "Most expertise" },
  { value: -0.5, label: "Lean expertise" },
  { value: 0, label: "Balanced" },
  { value: 0.5, label: "Lean speed" },
  { value: 1, label: "Fastest answer" },
] as const;

export type Weights = Record<Component, number>;

/** Weights for a tune position in [-1, 1]. 0 is RANK_CONFIG.weights exactly. */
export function weightsFor(tune: number): Weights {
  const t = Math.max(-1, Math.min(1, tune));
  if (t === 0) return { ...RANK_CONFIG.weights };
  const m = t < 0 ? RANK_CONFIG.tune.expertise : RANK_CONFIG.tune.speed;
  const k = Math.abs(t);
  const raw = Object.fromEntries(COMPONENTS.map((c) => [c, RANK_CONFIG.weights[c] * (1 + (m[c] - 1) * k)])) as Weights;
  const pos = POSITIVE_COMPONENTS.reduce((s, c) => s + raw[c], 0);
  const out = { ...raw };
  for (const c of POSITIVE_COMPONENTS) out[c] = (raw[c] * 100) / pos;
  return out;
}

// ---------------------------------------------------------------------------
// features: what the server measured, stored per candidate, re-scored on the client
// ---------------------------------------------------------------------------

export type ExcludeRule = "hard_cap" | "out_of_office";
export type GuardrailRule = ExcludeRule | "cooldown" | "spread";

export const GUARDRAIL_LABEL: Record<GuardrailRule, string> = {
  hard_cap: "Weekly ask limit",
  out_of_office: "Out of office",
  cooldown: "24 hour cooldown",
  spread: "Spread",
};

export type AvailabilityStatus = "free" | "booked" | "ooo" | "unknown";

export type Features = {
  employeeId: string;
  name: string;
  title: string;
  team: string;
  seniority: string;
  raw: Record<Component, number>;
  detail: Record<Component, string>;
  load: { count: number; max: number };
  availability: {
    status: AvailabilityStatus;
    /** First usable gap inside the urgency horizon (what the score measures). */
    nextFreeAt: string | null;
    nextFreeLabel: string | null;
    horizonLabel: string;
    /** Next usable window in the 14 day search, in the asker's zone with theirs in parentheses. Absent on asks ranked before prompt 7. */
    window?: WindowView | null;
    windowReason?: string;
    counts?: { hard: number; soft: number };
    /** Call, DM or async message, and why (src/lib/availability.ts recommendChannel). */
    recommendation?: Recommendation | null;
  };
  /** Services from the ask this person owns. */
  ownerOf: Array<{ serviceId: string; serviceName: string; role: "primary" | "secondary" }>;
  /** Set when a hard guardrail removes them from the shortlist. */
  excluded: { rule: ExcludeRule; reason: string } | null;
};

export type Scored = Features & {
  /** weight times raw, negative for loadPenalty. */
  contributions: Record<Component, number>;
  score: number;
  /** Expertise only (ownership, skill, recency at base weights), 0..1. Drives the floor and spread. */
  relevance: number;
};

export type Flag = { rule: "cooldown" | "spread"; note: string };

export type Ranked = Scored & { rank: number; flags: Flag[] };

export type GuardrailReport = { rule: GuardrailRule; fired: boolean; summary: string; people: string[] };

export type RankContext = {
  tune: number;
  /** People this asker already got as their top suggestion in the cooldown window. */
  cooled: Record<string, { askId: string; at: string }>;
};

export type RankOutcome = {
  tune: number;
  weights: Weights;
  shortlist: Ranked[];
  /** Eligible people below the shortlist, in score order. */
  rest: Scored[];
  excluded: Scored[];
  guardrails: GuardrailReport[];
  whyNot: { employeeId: string; text: string } | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
export const firstName = (name: string) => name.split(" ")[0] ?? name;

export function relevanceOf(raw: Record<Component, number>): number {
  const w = RANK_CONFIG.weights;
  const total = EXPERTISE_COMPONENTS.reduce((s, c) => s + w[c], 0);
  return EXPERTISE_COMPONENTS.reduce((s, c) => s + w[c] * raw[c], 0) / total;
}

export function scoreFeatures(f: Features, weights: Weights): Scored {
  const contributions = Object.fromEntries(COMPONENTS.map((c) => [c, round1((c === "loadPenalty" ? -1 : 1) * weights[c] * f.raw[c])])) as Record<Component, number>;
  const sum = COMPONENTS.reduce((s, c) => s + contributions[c], 0);
  return { ...f, contributions, score: round1(Math.max(0, Math.min(100, sum))), relevance: Math.round(relevanceOf(f.raw) * 1000) / 1000 };
}

const byScore = (a: Scored, b: Scored) => b.score - a.score || b.relevance - a.relevance || a.employeeId.localeCompare(b.employeeId);

export function rankCandidates(features: Features[], ctx: RankContext): RankOutcome {
  const G = RANK_CONFIG.guardrails;
  const S = RANK_CONFIG.shortlist;
  const weights = weightsFor(ctx.tune);
  const scored = features.map((f) => scoreFeatures(f, weights));
  const excluded = scored.filter((s) => s.excluded).sort((a, b) => b.relevance - a.relevance || byScore(a, b));
  const eligible = scored.filter((s) => !s.excluded).sort(byScore);
  const flags = new Map<string, Flag[]>();
  const flag = (id: string, f: Flag) => flags.set(id, [...(flags.get(id) ?? []), f]);
  const reports: GuardrailReport[] = [];

  // hard cap and out of office were decided with the features; report them here.
  for (const rule of ["hard_cap", "out_of_office"] as const) {
    const hit = excluded.filter((s) => s.excluded?.rule === rule);
    reports.push({
      rule,
      fired: hit.length > 0,
      summary: hit.length
        ? hit.map((s) => `${s.name}: ${s.excluded!.reason}`).join("; ")
        : rule === "hard_cap"
          ? "Nobody considered is at their weekly ask limit."
          : "Nobody considered is out of office for the whole window.",
      people: hit.map((s) => s.employeeId),
    });
  }

  // cooldown: never the same top suggestion twice in 24 hours, unless nobody else is relevant enough.
  const top = eligible[0];
  const cooledTop = top ? ctx.cooled[top.employeeId] : undefined;
  if (top && cooledTop) {
    const alt = eligible.slice(1).find((s) => s.relevance >= G.relevanceFloor && !ctx.cooled[s.employeeId]);
    if (alt) {
      eligible.splice(eligible.indexOf(alt), 1);
      eligible.unshift(alt);
      flag(top.employeeId, { rule: "cooldown", note: `Was your top suggestion in the last ${G.cooldownHours} hours (${cooledTop.askId}), so ${firstName(alt.name)} goes first this time to share the load.` });
      reports.push({ rule: "cooldown", fired: true, summary: `${top.name} was already your top suggestion for ${cooledTop.askId}; moved ${alt.name} to #1.`, people: [top.employeeId, alt.employeeId] });
    } else {
      reports.push({ rule: "cooldown", fired: false, summary: `${top.name} was your top suggestion for ${cooledTop.askId}, but nobody else clears the relevance floor (${G.relevanceFloor}), so they stay #1.`, people: [top.employeeId] });
    }
  } else {
    const n = Object.keys(ctx.cooled).length;
    reports.push({ rule: "cooldown", fired: false, summary: n ? `Your recent top suggestions (${n}) are not #1 here.` : `No top suggestion for you in the last ${G.cooldownHours} hours.`, people: [] });
  }

  // shortlist: top `max`, and after `min` only people close enough to #1.
  let shortlist = eligible.slice(0, S.max).filter((s, i) => i < S.min || s.score >= eligible[0].score * S.keepAboveShareOfTop);

  // spread: at least one person who is not one of the obvious experts.
  const best = Math.max(0, ...eligible.map((s) => s.relevance));
  const senior = G.seniorLevels as readonly string[];
  const isExpert = (s: Scored) => s.ownerOf.length > 0 || (best > 0 && (s.relevance >= best * G.spreadExpertShare || (senior.includes(s.seniority) && s.relevance >= best * G.spreadSeniorShare)));
  if (!shortlist.length) {
    reports.push({ rule: "spread", fired: false, summary: "Nobody eligible, so there is nothing to spread.", people: [] });
  } else if (shortlist.some((s) => !isExpert(s))) {
    const other = shortlist.find((s) => !isExpert(s))!;
    reports.push({ rule: "spread", fired: false, summary: `Already has a different angle: ${other.name} is not one of the obvious experts.`, people: [other.employeeId] });
  } else {
    const alt = eligible.find((s) => !shortlist.includes(s) && !isExpert(s) && s.relevance >= G.relevanceFloor);
    if (alt) {
      const dropped = shortlist.length >= S.max ? shortlist[shortlist.length - 1] : null;
      shortlist = [...(dropped ? shortlist.slice(0, -1) : shortlist), alt];
      flag(alt.employeeId, { rule: "spread", note: "Not one of the obvious experts: added so you have a real choice, and so the experts are not the only names new hires hear." });
      reports.push({
        rule: "spread",
        fired: true,
        summary: `Everyone on the shortlist was an obvious expert; added ${alt.name}${dropped ? ` in place of ${dropped.name}` : ""}.`,
        people: [alt.employeeId, ...(dropped ? [dropped.employeeId] : [])],
      });
    } else {
      reports.push({ rule: "spread", fired: false, summary: `Everyone on the shortlist is an obvious expert and nobody else clears the relevance floor (${G.relevanceFloor}).`, people: [] });
    }
  }

  const ranked: Ranked[] = shortlist.map((s, i) => ({ ...s, rank: i + 1, flags: flags.get(s.employeeId) ?? [] }));
  const rest = eligible.filter((s) => !shortlist.includes(s));
  return { tune: ctx.tune, weights, shortlist: ranked, rest, excluded, guardrails: reports, whyNot: whyNot(ranked, rest, excluded, reports) };
}

// ---------------------------------------------------------------------------
// the plain sentences: why not someone, and the template reason
// ---------------------------------------------------------------------------

function ownerPhrase(s: Scored): string {
  const own = s.ownerOf.find((o) => o.role === "primary") ?? s.ownerOf[0];
  if (own) return own.role === "primary" ? `owns ${own.serviceName}` : `is the backup owner of ${own.serviceName}`;
  return "has the most relevant experience";
}

function topPhrase(top: Ranked, excludedOwner: Scored): string {
  const shared = top.ownerOf.find((o) => excludedOwner.ownerOf.some((x) => x.serviceId === o.serviceId));
  if (shared) return `the ${shared.role === "primary" ? "primary" : "secondary"} owner, ${top.name}`;
  return top.name;
}

/**
 * One line about someone the asker might expect but is not #1, in this order: an owner who was
 * excluded (the clearest load balancing story), a person the cooldown moved, an owner who ranks
 * lower (why, in the component where they lose most to #1), anyone else excluded with real
 * relevance, and finally the most relevant person who is not #1.
 */
export function whyNot(shortlist: Ranked[], rest: Scored[], excluded: Scored[], reports: GuardrailReport[]): RankOutcome["whyNot"] {
  const top = shortlist[0];
  if (!top) return null;
  const primaryFirst = (a: Scored, b: Scored) => Number(b.ownerOf.some((o) => o.role === "primary")) - Number(a.ownerOf.some((o) => o.role === "primary")) || b.relevance - a.relevance;
  const excludedLine = (pick: Scored) => {
    const why = pick.excluded!.rule === "hard_cap" ? `is at their weekly ask limit (${pick.load.count} of ${pick.load.max} asks this week)` : `is out of office for ${pick.availability.horizonLabel}`;
    return { employeeId: pick.employeeId, text: `${firstName(pick.name)} ${ownerPhrase(pick)} but ${why}, so we routed to ${topPhrase(top, pick)}.` };
  };
  const lowerLine = (s: Scored) => {
    const gaps = (["availability", "loadPenalty", "timezone", "mentorFit", "proximity"] as const).map((c) => ({ c, gap: top.contributions[c] - s.contributions[c] }));
    const worst = gaps.sort((a, b) => b.gap - a.gap)[0];
    const place = shortlist.find((x) => x.employeeId === s.employeeId);
    return {
      employeeId: s.employeeId,
      text: `${firstName(s.name)} ${ownerPhrase(s)} but ${place ? `ranks #${place.rank}` : "is not on the shortlist"}, mostly on ${COMPONENT_LABEL[worst.c].toLowerCase()} (${s.detail[worst.c]}), so ${top.name} comes first.`,
    };
  };

  const exOwner = excluded.filter((s) => s.ownerOf.length).sort(primaryFirst)[0];
  if (exOwner) return excludedLine(exOwner);
  const cooled = reports.find((r) => r.rule === "cooldown" && r.fired);
  const moved = cooled && shortlist.find((x) => x.employeeId === cooled.people[0]);
  if (moved) return { employeeId: moved.employeeId, text: `${firstName(moved.name)} was your top suggestion in the last ${RANK_CONFIG.guardrails.cooldownHours} hours, so ${top.name} goes first this time and ${firstName(moved.name)} is #${moved.rank}.` };
  const lowOwner = [...shortlist, ...rest].filter((s) => s.employeeId !== top.employeeId && s.ownerOf.length && !top.ownerOf.some((o) => o.role === "primary")).sort(primaryFirst)[0];
  if (lowOwner && lowOwner.relevance >= top.relevance * 0.8) return lowerLine(lowOwner);
  const exOther = excluded.find((s) => s.relevance >= RANK_CONFIG.guardrails.relevanceFloor);
  if (exOther) return excludedLine(exOther);
  const expert = [...shortlist, ...rest].reduce<Scored | null>((b, s) => (!b || s.relevance > b.relevance ? s : b), null);
  if (!expert || expert.employeeId === top.employeeId) return null;
  return lowerLine(expert);
}

const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The fallback reason: the two components that added the most, in plain words. */
export function templateReason(s: Scored): string {
  const parts = POSITIVE_COMPONENTS.map((c) => ({ c, v: s.contributions[c] }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 2)
    .map((x) => s.detail[x.c]);
  if (!parts.length) return "Came up in the search, with little direct evidence.";
  return `${capFirst(parts.join("; "))}.`;
}

/** The two components behind the template, for logs. */
export function topComponents(s: Scored, n = 2): PositiveComponent[] {
  return POSITIVE_COMPONENTS.map((c) => ({ c, v: s.contributions[c] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.c);
}

/** "ownership 0.80x28=+22.4 ..." for the per-candidate log line. */
export function breakdownLine(s: Scored, weights: Weights): string {
  return COMPONENTS.map((c) => `${c} ${s.raw[c].toFixed(2)}x${round1(weights[c])}=${s.contributions[c] >= 0 && c !== "loadPenalty" ? "+" : ""}${s.contributions[c].toFixed(1)}`).join(", ");
}
