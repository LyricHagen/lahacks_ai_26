// Shape of fixtures/company.json: the whole synthetic company, text and embeddings included.
//
// Dates are stored as day offsets from the day the seed is loaded ("startDay: -45" means the
// person started 45 days before the load day), so new hires stay new and next week's vacation
// stays next week no matter when the database is reseeded. Calendars are not stored: they are
// generated at load time from each person's calendar profile, deterministically from the seed
// string and the load day.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Zone } from "@/lib/time";

export const FIXTURE_VERSION = 1;
export const DEFAULT_SEED = "corvid-v1";
export const FIXTURE_PATH = join(process.cwd(), "fixtures", "company.json");

export type Seniority = "junior" | "mid" | "senior" | "staff" | "principal" | "manager" | "director" | "executive";

export type CalendarArchetype = "exec" | "manager" | "engineer" | "support" | "business" | "designer";

export type CalendarProfile = {
  archetype: CalendarArchetype;
  /** Inclusive day offsets of an out-of-office block. */
  ooo?: { from: number; to: number; title: string };
  /** Number of days from the load day that are wall-to-wall meetings. */
  fullyBookedDays?: number;
  /** Denser than the archetype: the overloaded seniors. */
  heavy?: boolean;
  /** Weekly office hours (busy=false, open to interruptions). Mentors only. */
  officeHours?: { weekday: number; startMin: number };
};

export type FxEmployee = {
  id: string;
  name: string;
  title: string;
  department: string;
  team: string;
  seniority: Seniority;
  timezone: Zone;
  startDay: number;
  managerId: string | null;
  slackHandle: string;
  email: string;
  bio: string;
  isMentor: boolean;
  maxWeeklyAsks: number;
  calendar: CalendarProfile;
  /** Planted role, for the scenario table and debugging. Never used by ranking. */
  planted?: string;
  embedding: number[];
};

export type FxSkill = { id: string; name: string; category: string; aliases: string[] };
export type FxSkillSource = "owns_service" | "project" | "authored_doc" | "team" | "profile";
export type FxEmployeeSkill = { employeeId: string; skillId: string; proficiency: number; source: FxSkillSource; evidence: string };

export type FxService = {
  id: string;
  name: string;
  repo: string;
  description: string;
  team: string;
  primaryOwnerId: string;
  secondaryOwnerId: string;
  skillIds: string[];
  embedding: number[];
};

export type FxProject = {
  id: string;
  name: string;
  description: string;
  team: string;
  serviceId: string | null;
  status: "active" | "finished";
  startDay: number;
  endDay: number | null;
  members: { employeeId: string; role: "lead" | "contributor" | "reviewer" | "advisor"; startDay: number; endDay: number | null }[];
};

export type FxDocument = {
  id: string;
  title: string;
  kind: "onboarding" | "runbook" | "how_to" | "reference";
  authorId: string;
  serviceId: string | null;
  body: string;
  updatedDay: number;
  embedding: number[];
};

export type FxMentorship = { mentorId: string; menteeId: string; focus: string; startDay: number; endDay: number | null };

export type FxAsk = {
  id: string;
  askerEmployeeId: string;
  title: string;
  body: string;
  tried: string;
  status: "sent" | "resolved";
  routedToId: string;
  serviceId: string;
  createdDay: number;
  /** Minutes after 09:00 in the asker's zone. */
  createdMinute: number;
  resolvedDay: number | null;
};

export type FxScenario = {
  id: string;
  kind: string;
  question: string;
  serviceId: string;
  /** Employee id, or "doc" when the document should be offered first. */
  expectId: string;
  trapIds: string[];
  docId: string | null;
  why: string;
};

export type TextProvenance = {
  /** "model" when a model wrote bios, project descriptions and doc bodies; "template" otherwise. */
  source: "model" | "template";
  model: string | null;
  modelItems: number;
  templateItems: number;
  note: string;
};

export type Company = {
  version: number;
  seed: string;
  generatedAt: string;
  text: TextProvenance;
  embedding: { model: string; dims: number };
  org: { id: string; name: string; domain: string; description: string };
  employees: FxEmployee[];
  skills: FxSkill[];
  employeeSkills: FxEmployeeSkill[];
  services: FxService[];
  projects: FxProject[];
  documents: FxDocument[];
  mentorships: FxMentorship[];
  asks: FxAsk[];
  scenarios: FxScenario[];
};

export async function readFixture(path = FIXTURE_PATH): Promise<Company | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as Company;
}

/**
 * One record per line inside each array, so the committed file diffs cleanly and stays readable.
 */
export async function writeFixture(company: Company, path = FIXTURE_PATH): Promise<number> {
  const lines: string[] = ["{"];
  const entries = Object.entries(company);
  entries.forEach(([key, value], i) => {
    const comma = i < entries.length - 1 ? "," : "";
    if (Array.isArray(value)) {
      lines.push(`  ${JSON.stringify(key)}: [`);
      value.forEach((item, j) => lines.push(`    ${JSON.stringify(item)}${j < value.length - 1 ? "," : ""}`));
      lines.push(`  ]${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push("}");
  const text = lines.join("\n") + "\n";
  await writeFile(path, text, "utf8");
  return text.length;
}
