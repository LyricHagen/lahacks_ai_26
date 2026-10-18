// The weekly ramp plan, as stored in ramp_plans.plan and rendered by /ramp. No server imports.
//
// A plan is built from the owner's own ask history and the seeded company only. Every item points
// at one row (a document, a colleague or a project) and carries the facts it was built from, so
// the page can show where each suggestion came from.

/** Asks that got past the confirm step before a plan is built. Below this the page says so plainly. */
export const RAMP_MIN_ASKS = 3;
export const RAMP_LEARN_MIN = 2;
export const RAMP_LEARN_MAX = 3;

export const RAMP_SECTIONS = ["learn", "stretch", "meet"] as const;
export type RampSection = (typeof RAMP_SECTIONS)[number];
export const RAMP_SECTION_LABEL: Record<RampSection, string> = { learn: "Things to learn", stretch: "Stretch task", meet: "Someone worth meeting" };

export type RampRefKind = "document" | "employee" | "project";

/** A gap: a skill the asks point at, with the plain reasons. */
export type RampGap = { skillId: string; name: string; score: number; signals: string[]; askIds: string[] };

export type RampItem = {
  section: RampSection;
  refKind: RampRefKind;
  /** doc_..., emp_..., prj_... */
  refId: string;
  href: string;
  title: string;
  subtitle: string;
  /** One or two sentences: why this, for this person, this week. */
  why: string;
  /** Stretch only: the concrete task. */
  task: string | null;
  skillId: string | null;
  skillName: string | null;
  /** The facts the item was built from, shown under "Built from". */
  facts: string[];
  /** live (model), demo (fixture) or template (the model's sentence failed the fact check). */
  textSource: "live" | "demo" | "template";
};

export type RampHistory = { asks: number; askIds: string[]; services: Array<{ id: string; name: string; asks: number }>; skills: Array<{ id: string; name: string; asks: number }> };

export type RampPlanReady = {
  version: 1;
  status: "ready";
  weekStart: string;
  /** What the owner played when it was built. */
  persona: { id: string; name: string; team: string; daysIn: number | null };
  history: RampHistory;
  gaps: RampGap[];
  learn: RampItem[];
  stretch: RampItem | null;
  meet: RampItem | null;
  /** Why a section is empty, said plainly. */
  missing: Partial<Record<RampSection, string>>;
  /** refIds left out because the owner dismissed them earlier. */
  leftOut: string[];
  source: "live" | "demo" | "template";
  note: string | null;
  builtAt: string;
  appNow: string;
};

export type RampPlanEmpty = {
  version: 1;
  status: "not_enough_history";
  weekStart: string;
  /** Said plainly on the page. */
  reason: string;
  persona: { id: string; name: string; team: string; daysIn: number | null };
  history: RampHistory;
  need: number;
  builtAt: string;
  appNow: string;
};

export type RampPlan = RampPlanReady | RampPlanEmpty;

export type RampWeek = "this" | "next";
