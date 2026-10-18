// The persona the guided demo plays: a backend engineer on the Payments team, eleven days into
// the job at the pinned demo clock. Added to the company at load time (like the calendars), not
// stored in fixtures/company.json, so adding it shifts no other seeded id. Planted as
// newhire_backend: signup and the persona switch never claim it, only the demo account plays it.

import { demoInstant } from "@/lib/clock";
import { DEMO_PERSONA_KEY } from "@/lib/demo-script";
import { embedText } from "@/lib/embed";
import { daysBetween, localDate } from "@/lib/time";
import type { Company, FxEmployee, FxEmployeeSkill } from "./fixture";
import { employeeEmbeddingText } from "./generate";

export { DEMO_PERSONA_KEY };
/** Days into the job at the pinned demo instant. */
export const DEMO_PERSONA_DAYS_IN = 11;

const TEAM = "Payments";
const NAMES = ["Robert Barajas", "Robert Achterberg", "Sam Oyelaran"];

type Logger = { info: (msg: string, ctx?: Record<string, unknown>) => void; warn: (msg: string, ctx?: Record<string, unknown>) => void };

/**
 * Adds the demo persona to a loaded company. Deterministic: same company and load day, same row.
 * Idempotent: a company that already has one is left alone.
 */
export function addDemoPersona(c: Company, anchorIso: string, log: Logger): FxEmployee | null {
  const existing = c.employees.find((e) => e.planted === DEMO_PERSONA_KEY);
  if (existing) return existing;
  const manager = c.employees.find((e) => e.team === TEAM && e.seniority === "manager");
  if (!manager) {
    log.warn(`no ${TEAM} manager in this company, so the demo persona was not added (the guided demo will say so)`);
    return null;
  }
  const taken = new Set(c.employees.map((e) => e.name));
  const name = NAMES.find((n) => !taken.has(n)) ?? `${NAMES[0]} II`;
  const first = name.split(" ")[0];
  const num = Math.max(...c.employees.map((e) => Number(e.id.slice(4)) || 0)) + 1;
  // Start day relative to the load day, so the pinned instant (first weekday on or after it) is
  // exactly DEMO_PERSONA_DAYS_IN days after the start, whatever weekday the seed was loaded on.
  const pinnedDay = localDate(demoInstant(anchorIso), "America/Los_Angeles");
  const startDay = daysBetween(anchorIso, pinnedDay) - DEMO_PERSONA_DAYS_IN;
  const e: FxEmployee = {
    id: `emp_${num}`,
    name,
    title: "Backend Engineer I",
    department: manager.department,
    team: TEAM,
    seniority: "junior",
    timezone: "America/Los_Angeles",
    startDay,
    managerId: manager.id,
    slackHandle: `@${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/\.([a-z])[a-z]*$/, ".$1")}`,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@ferndale.example`,
    bio: `${first} is a Backend Engineer I on the Payments team, based in Los Angeles. Joined Ferndale ${DEMO_PERSONA_DAYS_IN} days ago after writing Go services at a logistics startup. Still learning how billing and deploys work here.`,
    isMentor: false,
    maxWeeklyAsks: 2,
    calendar: { archetype: "engineer" },
    planted: DEMO_PERSONA_KEY,
    embedding: [],
  };
  const skills: FxEmployeeSkill[] = [
    { employeeId: e.id, skillId: "skl_go", proficiency: 2, source: "team", evidence: "Wrote Go services before joining; is learning Ferndale's Go codebase on the Payments team." },
    { employeeId: e.id, skillId: "skl_postgres", proficiency: 1, source: "team", evidence: "Is learning Postgres as a new member of the Payments team." },
    { employeeId: e.id, skillId: "skl_payments", proficiency: 1, source: "team", evidence: "Is learning Payments as a new member of the Payments team." },
  ].filter((s) => c.skills.some((k) => k.id === s.skillId)) as FxEmployeeSkill[];
  c.employees.push(e);
  c.employeeSkills.push(...skills);
  e.embedding = embedText(employeeEmbeddingText(c, e));
  log.info(`demo persona ${e.id} ${e.name} (${e.title}, ${TEAM}) added at load: starts day ${startDay}, ${DEMO_PERSONA_DAYS_IN} days in at the pinned demo instant, manager ${manager.id}`, {
    planted: DEMO_PERSONA_KEY,
    skills: skills.map((s) => s.skillId),
  });
  return e;
}
