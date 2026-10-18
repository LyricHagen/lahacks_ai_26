// Builds the whole synthetic company from a seed string. Pure and deterministic: no database,
// no network, no clock (dates are day offsets from the load day). Text is templated here; the
// fixture script can replace bios, project descriptions and generic doc bodies with model text
// afterwards, then calls embedCompany so embeddings match the final text.

import { wallNow } from "@/lib/clock";
import { EMBEDDING_DIMS, EMBEDDING_MODEL, embedText } from "@/lib/embed";
import type { Logger } from "@/lib/log";
import type { Zone } from "@/lib/time";
import {
  ASK_TEMPLATES,
  DEPARTMENTS,
  type DeptKey,
  FIRST_NAMES,
  GENERAL_DOCS,
  LAST_NAMES,
  NAME_OVERRIDES,
  ORG,
  PLANTED,
  PLANTED_DOCS,
  PROJECTS,
  SCENARIOS,
  SERVICES,
  SKILLS,
  TEAMS,
  TITLES,
  type TeamDef,
  type Track,
} from "./catalog";
import {
  type CalendarArchetype,
  type CalendarProfile,
  type Company,
  FIXTURE_VERSION,
  type FxAsk,
  type FxDocument,
  type FxEmployee,
  type FxEmployeeSkill,
  type FxMentorship,
  type FxProject,
  type FxScenario,
  type FxService,
  type FxSkillSource,
  type Seniority,
} from "./fixture";
import { createRng, type Rng } from "./rng";
import { GENERAL_BODIES, MENTOR_FOCUS, serviceOverviewBody, serviceRunbookBody, templateBio } from "./templates";

const LEVEL_SENIORITY: Seniority[] = ["junior", "mid", "senior", "staff", "principal"];
const BASE_MAX_ASKS: Record<Seniority, number> = { junior: 2, mid: 3, senior: 4, staff: 3, principal: 2, manager: 2, director: 1, executive: 0 };
const SOURCE_RANK: Record<FxSkillSource, number> = { owns_service: 5, project: 4, authored_doc: 3, team: 2, profile: 1 };
const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
const TEAM_BY_KEY = new Map(TEAMS.map((t) => [t.key, t]));

/** Internal person record: the fixture employee plus generator-only facts. */
type Person = FxEmployee & { first: string; level: number; track: Track; teamKey: string; dept: DeptKey; isNewHire: boolean; plantedHook?: string };

function archetypeFor(track: Track, seniority: Seniority): CalendarArchetype {
  if (seniority === "executive" || seniority === "director") return "exec";
  if (seniority === "manager" || track === "pm") return "manager";
  if (track === "support" || track === "csm") return "support";
  if (track === "design" || track === "research" || track === "analyst") return "designer";
  if (track === "it" || track === "people" || track === "finance") return "business";
  return "engineer";
}

function startDayFor(rng: Rng, seniority: Seniority): number {
  const ranges: Record<Seniority, [number, number]> = {
    junior: [120, 420],
    mid: [150, 900],
    senior: [240, 1500],
    staff: [600, 2200],
    principal: [1100, 2600],
    manager: [300, 2000],
    director: [700, 2600],
    executive: [2900, 2900],
  };
  const [a, b] = ranges[seniority];
  return -rng.int(a, b);
}

function ascii(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function generateCompany(seed: string, log: Logger): Company {
  const root = createRng(seed);
  const t0 = performance.now();

  // -------------------------------------------------------------------------
  // People and the reporting tree
  // -------------------------------------------------------------------------
  const nameRng = root.fork("names");
  const usedNames = new Set<string>();
  const usedEmails = new Set<string>();
  const usedHandles = new Set<string>();
  const nextName = (): { first: string; last: string } => {
    for (let i = 0; i < 1000; i++) {
      const first = nameRng.pick(FIRST_NAMES);
      const last = nameRng.pick(LAST_NAMES);
      if (!usedNames.has(`${first} ${last}`)) {
        usedNames.add(`${first} ${last}`);
        const override = NAME_OVERRIDES[`${first} ${last}`];
        if (override) usedNames.add(`${override.first} ${override.last}`);
        return override ?? { first, last };
      }
    }
    throw new Error("ran out of unique names; add more to FIRST_NAMES or LAST_NAMES");
  };

  const people: Person[] = [];
  let nextId = 101;
  const peopleRng = root.fork("people");

  const makePerson = (o: {
    title: string;
    dept: DeptKey;
    teamName: string;
    teamKey: string;
    track: Track;
    seniority: Seniority;
    level: number;
    tz: Zone;
    managerId: string | null;
    startDay?: number;
    planted?: string;
  }): Person => {
    const { first, last } = nextName();
    let email = `${ascii(first)}.${ascii(last)}@${ORG.domain}`;
    for (let n = 2; usedEmails.has(email); n++) email = `${ascii(first)}.${ascii(last)}${n}@${ORG.domain}`;
    usedEmails.add(email);
    let handle = `@${ascii(first)}.${ascii(last).slice(0, 1)}`;
    for (let n = 2; usedHandles.has(handle); n++) handle = `@${ascii(first)}.${ascii(last).slice(0, 2)}${n > 2 ? n : ""}`;
    usedHandles.add(handle);
    const deptName = DEPARTMENTS.find((d) => d.key === o.dept)!.name;
    const person: Person = {
      id: `emp_${nextId++}`,
      name: `${first} ${last}`,
      first,
      title: o.title,
      department: deptName,
      team: o.teamName,
      teamKey: o.teamKey,
      dept: o.dept,
      track: o.track,
      level: o.level,
      seniority: o.seniority,
      timezone: o.tz,
      startDay: o.startDay ?? startDayFor(peopleRng, o.seniority),
      managerId: o.managerId,
      slackHandle: handle,
      email,
      bio: "",
      isMentor: false,
      maxWeeklyAsks: BASE_MAX_ASKS[o.seniority],
      calendar: { archetype: archetypeFor(o.track, o.seniority) },
      planted: o.planted,
      isNewHire: false,
      embedding: [],
    };
    people.push(person);
    return person;
  };

  const ceo = makePerson({ title: "Chief Executive Officer", dept: "operations", teamName: "Leadership", teamKey: "leadership", track: "people", seniority: "executive", level: 6, tz: "America/Los_Angeles", managerId: null });
  const heads = new Map<DeptKey, Person>();
  for (const d of DEPARTMENTS) {
    const tz = d.key === "security" ? "America/New_York" : peopleRng.weighted<Zone>({ "America/Los_Angeles": 6, "America/New_York": 4 });
    heads.set(d.key, makePerson({ title: d.headTitle, dept: d.key, teamName: "Leadership", teamKey: "leadership", track: d.headTrack, seniority: "director", level: 6, tz, managerId: ceo.id }));
  }

  const managers = new Map<string, Person>();
  const icsByTeam = new Map<string, Person[]>();
  const planted = new Map<string, Person>();

  for (const team of TEAMS) {
    const head = heads.get(team.dept)!;
    const mgr = makePerson({
      title: TITLES[team.track][5],
      dept: team.dept,
      teamName: team.name,
      teamKey: team.key,
      track: team.track,
      seniority: "manager",
      level: 5,
      tz: peopleRng.weighted<Zone>(team.tz),
      managerId: head.id,
    });
    managers.set(team.key, mgr);
    const ics: Person[] = [];
    for (const pd of PLANTED.filter((x) => x.team === team.key)) {
      const sen = LEVEL_SENIORITY[pd.level];
      const person = makePerson({
        title: pd.title ?? TITLES[team.track][pd.level],
        dept: team.dept,
        teamName: team.name,
        teamKey: team.key,
        track: team.track,
        seniority: sen,
        level: pd.level,
        tz: pd.timezone ?? peopleRng.weighted<Zone>(team.tz),
        managerId: mgr.id,
        startDay: pd.startDayOffset,
        planted: pd.key,
      });
      person.plantedHook = pd.bioHook;
      if (pd.kind === "new_hire") person.isNewHire = true;
      planted.set(pd.key, person);
      ics.push(person);
    }
    for (let i = 0; i < team.size; i++) {
      const level = peopleRng.weighted<"0" | "1" | "2" | "3">({ "0": 2, "1": 4, "2": 3, "3": 1 });
      const lv = Number(level);
      ics.push(
        makePerson({
          title: TITLES[team.track][lv],
          dept: team.dept,
          teamName: team.name,
          teamKey: team.key,
          track: team.track,
          seniority: LEVEL_SENIORITY[lv],
          level: lv,
          tz: peopleRng.weighted<Zone>(team.tz),
          managerId: mgr.id,
        }),
      );
    }
    icsByTeam.set(team.key, ics);
  }
  log.info(`people: ${people.length} employees, ${heads.size} department heads, ${managers.size} team managers`, { planted: planted.size });

  const byId = new Map(people.map((p) => [p.id, p]));
  const nonPlantedIcs = (teamKey: string) =>
    (icsByTeam.get(teamKey) ?? []).filter((p) => !p.planted).sort((a, b) => b.level - a.level || a.startDay - b.startDay);

  // -------------------------------------------------------------------------
  // Services: one primary and one secondary owner each
  // -------------------------------------------------------------------------
  const resolveSlot = (slot: string, teamKey: string): Person => {
    if (slot.startsWith("planted:")) {
      const p = planted.get(slot.slice(8));
      if (!p) throw new Error(`unknown planted slot ${slot}`);
      return p;
    }
    if (slot.startsWith("ic:")) {
      const list = nonPlantedIcs(teamKey);
      const p = list[Number(slot.slice(3))];
      if (!p) throw new Error(`team ${teamKey} has no ${slot}`);
      return p;
    }
    throw new Error(`bad slot ${slot}`);
  };

  const services: FxService[] = SERVICES.map((d) => {
    const primary = resolveSlot(d.primary, d.team);
    const secondary = resolveSlot(d.secondary, d.team);
    if (primary.id === secondary.id) throw new Error(`service ${d.id} has the same primary and secondary owner`);
    return {
      id: d.id,
      name: d.name,
      repo: d.repo,
      description: d.description,
      team: TEAM_BY_KEY.get(d.team)!.name,
      primaryOwnerId: primary.id,
      secondaryOwnerId: secondary.id,
      skillIds: d.skills,
      embedding: [],
    };
  });
  const ownerIds = new Set(services.flatMap((s) => [s.primaryOwnerId, s.secondaryOwnerId]));
  const serviceById = new Map(services.map((s) => [s.id, s]));
  // Owners are established people: never a fresh hire.
  for (const id of ownerIds) {
    const p = byId.get(id)!;
    if (p.startDay > -200) p.startDay = -200 - peopleRng.int(0, 400);
  }
  log.info(`services: ${services.length}, each with a primary and a secondary owner`, { distinctOwners: ownerIds.size });

  // -------------------------------------------------------------------------
  // New hires, mentors, capacity, calendars
  // -------------------------------------------------------------------------
  const hireRng = root.fork("new_hires");
  const hirePool = people.filter((p) => !p.planted && !ownerIds.has(p.id) && p.level <= 1 && p.seniority !== "manager");
  for (const p of hireRng.sample(hirePool, 15)) {
    p.isNewHire = true;
    p.startDay = -hireRng.int(3, 75);
  }
  const newHires = people.filter((p) => p.isNewHire);

  const mentorRng = root.fork("mentors");
  for (const p of people) {
    const kind = p.planted ? PLANTED.find((x) => x.key === p.planted)!.kind : null;
    if (kind === "overloaded") p.isMentor = true;
    else if (p.isNewHire) p.isMentor = false;
    else if (p.level >= 2 && p.level <= 4) p.isMentor = mentorRng.chance(0.5);
    else if (p.seniority === "manager") p.isMentor = mentorRng.chance(0.3);
    else if (p.level === 1) p.isMentor = mentorRng.chance(0.08);
    if (p.isMentor) p.maxWeeklyAsks += 1;
    if (kind === "overloaded") p.maxWeeklyAsks = 3;

    const pd = p.planted ? PLANTED.find((x) => x.key === p.planted) : undefined;
    const cal: CalendarProfile = { ...p.calendar };
    if (pd?.calendar?.heavy) cal.heavy = true;
    if (pd?.calendar?.oooFrom !== undefined) cal.ooo = { from: pd.calendar.oooFrom, to: pd.calendar.oooTo!, title: pd.calendar.oooTitle ?? "Out of office" };
    if (pd?.calendar?.fullyBookedDays) cal.fullyBookedDays = pd.calendar.fullyBookedDays;
    if (p.isMentor) cal.officeHours = { weekday: mentorRng.int(1, 4), startMin: mentorRng.pick([14 * 60, 15 * 60, 16 * 60]) };
    // A few ordinary people are out too, so availability is not only the planted cases.
    if (!pd && !ownerIds.has(p.id) && mentorRng.chance(0.04)) {
      const from = mentorRng.int(2, 9);
      cal.ooo = { from, to: from + mentorRng.int(1, 4), title: mentorRng.pick(["Out of office", "Vacation", "Conference"]) };
    }
    p.calendar = cal;
  }
  log.info(`new hires: ${newHires.length}, mentors: ${people.filter((p) => p.isMentor).length}`, {
    ooo: people.filter((p) => p.calendar.ooo).length,
    fullyBooked: people.filter((p) => p.calendar.fullyBookedDays).length,
  });

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------
  const projRng = root.fork("projects");
  const overloaded = people.filter((p) => p.planted?.startsWith("over_"));
  const projects: FxProject[] = PROJECTS.map((d, i) => {
    const members: FxProject["members"] = [];
    const add = (p: Person, role: FxProject["members"][number]["role"]) => {
      if (members.some((m) => m.employeeId === p.id)) return;
      let startDay = d.start + projRng.int(0, 20);
      if (p.startDay > startDay) {
        // Joined the company after the project started: only possible on an active project.
        if (d.end !== null || p.startDay + 5 > 0) return;
        startDay = p.startDay + 5;
      }
      members.push({ employeeId: p.id, role, startDay, endDay: d.end });
    };
    const teamIcs = nonPlantedIcs(d.team);
    const svcDef = d.service ? serviceById.get(d.service) : undefined;
    // The service's primary owner leads, unless they started after the project.
    const lead = svcDef ? byId.get(svcDef.primaryOwnerId)! : (teamIcs[0] ?? managers.get(d.team)!);
    add(lead, "lead");
    if (svcDef) add(byId.get(svcDef.secondaryOwnerId)!, "contributor");
    for (const p of projRng.sample(icsByTeam.get(d.team) ?? [], projRng.int(2, 4))) add(p, "contributor");
    if (d.end === null) for (const p of newHires.filter((h) => h.teamKey === d.team).slice(0, 1)) add(p, "contributor");
    for (const extra of d.extras) {
      if (extra.startsWith("planted:")) add(planted.get(extra.slice(8))!, projRng.pick(["reviewer", "advisor"] as const));
      else if (extra.startsWith("team:")) for (const p of projRng.sample(nonPlantedIcs(extra.slice(5)), projRng.int(1, 2))) add(p, "contributor");
    }
    // Overloaded seniors review their own team's projects too.
    for (const o of overloaded) if (o.teamKey === d.team) add(o, "reviewer");
    return {
      id: `prj_${String(i + 1).padStart(2, "0")}`,
      name: d.name,
      description: d.description,
      team: TEAM_BY_KEY.get(d.team)!.name,
      serviceId: d.service,
      status: d.end === null ? "active" : "finished",
      startDay: d.start,
      endDay: d.end,
      members,
    };
  });
  log.info(`projects: ${projects.length} (${projects.filter((p) => p.status === "active").length} active)`, {
    memberships: projects.reduce((s, p) => s + p.members.length, 0),
  });

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------
  const docAuthor = (author: string, serviceId: string | null): Person => {
    if (author.startsWith("team:")) return nonPlantedIcs(author.slice(5))[0];
    const svcRec = serviceId ? serviceById.get(serviceId) : undefined;
    if (!svcRec) throw new Error(`document author ${author} needs a service`);
    return byId.get(author === "primary" ? svcRec.primaryOwnerId : svcRec.secondaryOwnerId)!;
  };
  const docRng = root.fork("documents");
  const documents: FxDocument[] = [];
  for (const d of [...PLANTED_DOCS, ...GENERAL_DOCS]) {
    documents.push({ id: d.id, title: d.title, kind: d.kind, authorId: docAuthor(d.author, d.service).id, serviceId: d.service, body: d.body ?? GENERAL_BODIES[d.id], updatedDay: d.updated, embedding: [] });
  }
  for (const svcRec of services) {
    const def = SERVICES.find((x) => x.id === svcRec.id)!;
    const team = TEAM_BY_KEY.get(def.team)!;
    const primary = byId.get(svcRec.primaryOwnerId)!;
    const secondary = byId.get(svcRec.secondaryOwnerId)!;
    const key = svcRec.id.slice(4);
    documents.push({
      id: `doc_${key}_overview`,
      title: `${svcRec.name}: overview for new engineers`,
      kind: "onboarding",
      authorId: primary.id,
      serviceId: svcRec.id,
      body: serviceOverviewBody({ name: svcRec.name, repo: svcRec.repo, description: svcRec.description, team: team.name, teamKey: team.key, primary: primary.name, secondary: secondary.name, skills: svcRec.skillIds.map((id) => SKILL_BY_ID.get(id)!.name) }),
      updatedDay: -docRng.int(20, 200),
      embedding: [],
    });
    if (["swe", "mobile", "sre", "data", "ml", "security"].includes(team.track)) {
      documents.push({
        id: `doc_${key}_runbook`,
        title: `${svcRec.name} runbook`,
        kind: "runbook",
        authorId: secondary.id,
        serviceId: svcRec.id,
        body: serviceRunbookBody({ name: svcRec.name, repo: svcRec.repo, team: team.name, teamKey: team.key }),
        updatedDay: -docRng.int(10, 240),
        embedding: [],
      });
    }
  }
  log.info(`documents: ${documents.length} (${PLANTED_DOCS.length} planted answers)`);

  // -------------------------------------------------------------------------
  // Skills with evidence. Strongest source wins per person and skill.
  // -------------------------------------------------------------------------
  const skillRng = root.fork("skills");
  const skillMap = new Map<string, FxEmployeeSkill>();
  const giveSkill = (employeeId: string, skillId: string, proficiency: number, source: FxSkillSource, evidence: string) => {
    if (!SKILL_BY_ID.has(skillId)) throw new Error(`unknown skill ${skillId}`);
    const key = `${employeeId}|${skillId}`;
    const prev = skillMap.get(key);
    if (!prev || SOURCE_RANK[source] > SOURCE_RANK[prev.source] || (source === prev.source && proficiency > prev.proficiency)) {
      skillMap.set(key, { employeeId, skillId, proficiency: Math.max(proficiency, prev?.proficiency ?? 0), source, evidence });
    }
  };
  const skillName = (id: string) => SKILL_BY_ID.get(id)!.name;

  for (const svcRec of services) {
    for (const skillId of svcRec.skillIds) {
      giveSkill(svcRec.primaryOwnerId, skillId, 5, "owns_service", `Primary owner of ${svcRec.name} (${svcRec.repo}), which runs on ${skillName(skillId)}, and reviews most changes to it.`);
      giveSkill(svcRec.secondaryOwnerId, skillId, 4, "owns_service", `Secondary owner of ${svcRec.name}; covers ${skillName(skillId)} reviews and on-call when the primary owner is out.`);
    }
  }
  for (const proj of projects) {
    const svcRec = proj.serviceId ? serviceById.get(proj.serviceId) : undefined;
    if (!svcRec) continue;
    for (const m of proj.members) {
      const skillId = svcRec.skillIds[0];
      const verb = m.role === "lead" ? "Led" : m.role === "contributor" ? "Worked on" : m.role === "reviewer" ? "Reviewed the design for" : "Advised on";
      const when = proj.status === "finished" ? "a finished project" : "an active project";
      giveSkill(m.employeeId, skillId, m.role === "lead" ? 4 : 3, "project", `${verb} ${proj.name} (${when}), which changed ${svcRec.name}.`);
    }
  }
  for (const doc of documents) {
    const svcRec = doc.serviceId ? serviceById.get(doc.serviceId) : undefined;
    if (!svcRec) continue;
    const label = doc.kind === "how_to" ? "how-to" : doc.kind;
    giveSkill(doc.authorId, svcRec.skillIds[0], 4, "authored_doc", `Wrote the ${label} "${doc.title}".`);
  }
  for (const team of TEAMS) {
    for (const p of icsByTeam.get(team.key) ?? []) {
      const base = [2, 3, 4, 4, 5][p.level] ?? 3;
      const cores = skillRng.sample(team.core, Math.min(team.core.length, p.isNewHire ? 2 : skillRng.int(2, 4)));
      for (const k of cores) {
        const prof = Math.max(1, Math.min(5, base + skillRng.int(-1, 0) - (p.isNewHire ? 1 : 0)));
        const evidence = p.isNewHire
          ? `Is learning ${skillName(`skl_${k}`)} as a new member of the ${team.name} team.`
          : -p.startDay > 365
            ? `Has used ${skillName(`skl_${k}`)} on the ${team.name} team for over a year.`
            : `Uses ${skillName(`skl_${k}`)} every week on the ${team.name} team.`;
        giveSkill(p.id, `skl_${k}`, prof, "team", evidence);
      }
      if (!p.planted && skillRng.chance(0.55)) {
        const k = skillRng.pick(team.adjacent);
        giveSkill(p.id, `skl_${k}`, skillRng.int(2, 3), "profile", `Listed in their profile; we have not seen ${skillName(`skl_${k}`)} in their Ferndale work yet.`);
      }
    }
    const mgr = managers.get(team.key)!;
    for (const k of team.core.slice(0, 2)) giveSkill(mgr.id, `skl_${k}`, 3, "team", `Manages the ${team.name} team, which works in ${skillName(`skl_${k}`)} every day.`);
    giveSkill(mgr.id, "skl_recruiting", 3, "team", `Runs hiring for the ${team.name} team.`);
    if (team.track === "pm" || team.dept === "product") giveSkill(mgr.id, "skl_roadmapping", 4, "team", `Owns the roadmap process for ${team.name}.`);
  }
  for (const head of heads.values()) {
    giveSkill(head.id, "skl_roadmapping", 4, "team", `Sets the yearly plan for the ${head.department} department.`);
    giveSkill(head.id, "skl_recruiting", 3, "team", `Approves every hire in ${head.department}.`);
  }
  for (const pd of PLANTED) {
    const p = planted.get(pd.key)!;
    for (const ds of pd.decoySkills ?? []) {
      // Profile claims must not be overwritten by a team skill; set directly.
      skillMap.set(`${p.id}|${ds.skillId}`, { employeeId: p.id, skillId: ds.skillId, proficiency: ds.proficiency, source: "profile", evidence: ds.evidence });
    }
  }
  const employeeSkills = [...skillMap.values()].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.skillId.localeCompare(b.skillId));
  log.info(`employee skills: ${employeeSkills.length} across ${SKILLS.length} skills`, {
    bySource: Object.fromEntries((["owns_service", "project", "authored_doc", "team", "profile"] as const).map((s) => [s, employeeSkills.filter((x) => x.source === s).length])),
  });

  // -------------------------------------------------------------------------
  // Mentorships (active for new hires, finished for others)
  // -------------------------------------------------------------------------
  const mRng = root.fork("mentorships");
  const mentors = people.filter((p) => p.isMentor);
  const mentorships: FxMentorship[] = [];
  const assigned = new Set<string>();
  const addMentorship = (mentor: Person, mentee: Person, active: boolean) => {
    const startDay = mentee.startDay + mRng.int(1, 6);
    const endDay = active ? null : Math.min(-5, startDay + mRng.int(90, 150));
    if (!active && endDay !== null && endDay <= startDay) return;
    mentorships.push({ mentorId: mentor.id, menteeId: mentee.id, focus: mRng.pick(MENTOR_FOCUS), startDay, endDay });
  };
  const defaultPersona = planted.get("newhire_web")!;
  // Overloaded seniors mentor two current new hires each: one reason they are stretched thin.
  const hireQueue = mRng.shuffle(newHires.filter((h) => h.id !== defaultPersona.id));
  for (const o of overloaded) {
    const sameDept = hireQueue.filter((h) => h.dept === o.dept && !assigned.has(h.id));
    const picks = [...sameDept, ...hireQueue.filter((h) => !assigned.has(h.id) && h.dept !== o.dept)].slice(0, 2);
    for (const h of picks) {
      addMentorship(o, h, true);
      assigned.add(h.id);
    }
  }
  for (const h of newHires) {
    if (assigned.has(h.id)) continue;
    const pool = mentors.filter((m) => m.teamKey === h.teamKey && !m.planted?.startsWith("over_") && m.id !== h.id);
    const fallback = mentors.filter((m) => m.dept === h.dept && !m.planted?.startsWith("over_"));
    const mentor = mRng.pick(pool.length ? pool : fallback.length ? fallback : mentors);
    addMentorship(mentor, h, true);
    assigned.add(h.id);
  }
  const veterans = people.filter((p) => !p.isNewHire && p.startDay < -250 && p.level <= 3 && p.seniority !== "manager");
  for (const mentee of mRng.sample(veterans, 32)) {
    const pool = mentors.filter((m) => m.dept === mentee.dept && m.id !== mentee.id && m.startDay < mentee.startDay - 60);
    if (!pool.length) continue;
    // Overloaded seniors have mentored a lot in the past too.
    const over = pool.filter((m) => m.planted?.startsWith("over_"));
    const mentor = over.length && mRng.chance(0.4) ? mRng.pick(over) : mRng.pick(pool);
    addMentorship(mentor, mentee, false);
  }
  log.info(`mentorships: ${mentorships.length} (${mentorships.filter((m) => m.endDay === null).length} active)`);

  // -------------------------------------------------------------------------
  // Ask history: who has been asked what in the last three weeks
  // -------------------------------------------------------------------------
  const askRng = root.fork("asks");
  const askers = people.filter((p) => p.isNewHire || p.level === 0);
  const asks: FxAsk[] = [];
  const ownedBy = (id: string) => services.filter((s) => s.primaryOwnerId === id || s.secondaryOwnerId === id);
  const addAsk = (to: Person, day: number) => {
    // Pick across every template of every service they own, so two-service owners get variety.
    const owned = ownedBy(to.id);
    const pool = (owned.length ? owned : [askRng.pick(services)]).flatMap((sv) => (ASK_TEMPLATES[sv.id] ?? []).map((tpl) => ({ sv, tpl })));
    if (!pool.length) return;
    const { sv: svcRec, tpl } = askRng.pick(pool);
    const asker = askRng.pick(askers.filter((a) => a.id !== to.id && a.startDay <= day));
    if (!asker) return;
    const resolved = day < -2 && askRng.chance(0.85);
    asks.push({
      id: `ask_${asks.length + 1}`,
      askerEmployeeId: asker.id,
      title: tpl.title,
      body: tpl.body,
      tried: tpl.tried,
      status: resolved ? "resolved" : "sent",
      routedToId: to.id,
      serviceId: svcRec.id,
      createdDay: day,
      createdMinute: askRng.int(0, 8 * 60),
      resolvedDay: resolved ? Math.min(0, day + askRng.int(0, 3)) : null,
    });
  };
  for (const o of overloaded) {
    const thisWeek = o.maxWeeklyAsks * 2 + askRng.int(1, 3);
    for (let i = 0; i < thisWeek; i++) addAsk(o, -askRng.int(0, 6));
    for (let i = 0, n = askRng.int(5, 8); i < n; i++) addAsk(o, -askRng.int(7, 20));
  }
  for (const id of ownerIds) {
    const p = byId.get(id)!;
    if (p.planted?.startsWith("over_")) continue;
    const away = p.calendar.ooo && p.calendar.ooo.from <= 0;
    for (let i = 0, n = away ? 0 : askRng.int(0, 2); i < n; i++) addAsk(p, -askRng.int(0, 6));
    for (let i = 0, n = askRng.int(0, 3); i < n; i++) addAsk(p, -askRng.int(7, 20));
  }
  for (const p of askRng.sample(people.filter((x) => !ownerIds.has(x.id) && x.level >= 2 && x.level <= 3), 20)) addAsk(p, -askRng.int(0, 20));
  asks.sort((a, b) => a.createdDay - b.createdDay || a.createdMinute - b.createdMinute);
  asks.forEach((a, i) => (a.id = `ask_${i + 1}`));
  log.info(`asks: ${asks.length} seeded over the last 21 days`, { lastSevenDays: asks.filter((a) => a.createdDay >= -6).length });

  // -------------------------------------------------------------------------
  // Bios (templated; the fixture script may replace them with model text)
  // -------------------------------------------------------------------------
  const bioRng = root.fork("bios");
  const skillsOf = new Map<string, FxEmployeeSkill[]>();
  for (const es of employeeSkills) skillsOf.set(es.employeeId, [...(skillsOf.get(es.employeeId) ?? []), es]);
  for (const p of people) {
    const top = (skillsOf.get(p.id) ?? []).sort((a, b) => b.proficiency - a.proficiency).slice(0, 3).map((x) => skillName(x.skillId));
    p.bio = templateBio(bioRng, {
      first: p.first,
      title: p.title,
      team: p.team,
      track: p.track,
      tz: p.timezone,
      startDay: p.startDay,
      primaryOf: services.filter((s) => s.primaryOwnerId === p.id).map((s) => s.name),
      secondaryOf: services.filter((s) => s.secondaryOwnerId === p.id).map((s) => s.name),
      topSkills: top,
      hook: p.plantedHook,
      isMentor: p.isMentor,
      isLeader: p.teamKey === "leadership",
    });
  }

  // -------------------------------------------------------------------------
  // Scenarios with resolved ids
  // -------------------------------------------------------------------------
  const scenarios: FxScenario[] = SCENARIOS.map((sc) => {
    const svcRec = serviceById.get(sc.service)!;
    const slotId = (slot: string): string => {
      if (slot === "doc") return "doc";
      if (slot === "service:primary") return svcRec.primaryOwnerId;
      if (slot === "service:secondary") return svcRec.secondaryOwnerId;
      if (slot.startsWith("planted:")) return planted.get(slot.slice(8))!.id;
      throw new Error(`bad scenario slot ${slot}`);
    };
    return { id: sc.id, kind: sc.kind, question: sc.question, serviceId: sc.service, expectId: slotId(sc.expect), trapIds: sc.traps.map(slotId), docId: sc.docId ?? null, why: sc.why };
  });

  const employees: FxEmployee[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    department: p.department,
    team: p.team,
    seniority: p.seniority,
    timezone: p.timezone,
    startDay: p.startDay,
    managerId: p.managerId,
    slackHandle: p.slackHandle,
    email: p.email,
    bio: p.bio,
    isMentor: p.isMentor,
    maxWeeklyAsks: p.maxWeeklyAsks,
    calendar: p.calendar,
    ...(p.planted ? { planted: p.planted } : {}),
    embedding: [],
  }));

  const company: Company = {
    version: FIXTURE_VERSION,
    seed,
    generatedAt: wallNow().toISOString(),
    text: { source: "template", model: null, modelItems: 0, templateItems: employees.length + documents.length, note: "templated text, no model call" },
    embedding: { model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS },
    org: ORG,
    employees,
    skills: SKILLS.map((x) => ({ id: x.id, name: x.name, category: x.category, aliases: x.aliases })),
    employeeSkills,
    services,
    projects,
    documents,
    mentorships,
    asks,
    scenarios,
  };
  log.info(`generated company structure in ${Math.round(performance.now() - t0)}ms`, { seed });
  return company;
}

/** Text that represents a person for retrieval: role, team, skills (with aliases), services, bio. */
export function employeeEmbeddingText(c: Company, e: FxEmployee): string {
  const skillById = new Map(c.skills.map((x) => [x.id, x]));
  const skills = c.employeeSkills
    .filter((x) => x.employeeId === e.id)
    .map((x) => {
      const sk = skillById.get(x.skillId)!;
      return `${sk.name} ${sk.aliases.join(" ")}`;
    });
  const owns = c.services.filter((x) => x.primaryOwnerId === e.id || x.secondaryOwnerId === e.id).map((x) => `${x.name} ${x.description}`);
  return [e.title, `${e.team} team`, e.department, skills.join(". "), owns.join(". "), e.bio].join(". ");
}

/** Fill every embedding from the final text. Call after any text rewrite. */
export function embedCompany(c: Company, log: Logger): void {
  const t0 = performance.now();
  const skillById = new Map(c.skills.map((x) => [x.id, x]));
  for (const e of c.employees) e.embedding = embedText(employeeEmbeddingText(c, e));
  for (const sv of c.services) {
    const skills = sv.skillIds.map((id) => `${skillById.get(id)!.name} ${skillById.get(id)!.aliases.join(" ")}`);
    sv.embedding = embedText([sv.name, sv.repo, sv.description, sv.team, skills.join(". ")].join(". "));
  }
  for (const d of c.documents) d.embedding = embedText(`${d.title}. ${d.body}`);
  c.embedding = { model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS };
  log.info(`embedded ${c.employees.length + c.services.length + c.documents.length} records with ${EMBEDDING_MODEL} in ${Math.round(performance.now() - t0)}ms`, {
    employees: c.employees.length,
    services: c.services.length,
    documents: c.documents.length,
    dims: EMBEDDING_DIMS,
  });
}

/** Structural checks: the planted cases must hold or the demo is wrong. Returns problems. */
export function validateCompany(c: Company): string[] {
  const problems: string[] = [];
  const ids = new Set(c.employees.map((e) => e.id));
  for (const e of c.employees) if (e.managerId && !ids.has(e.managerId)) problems.push(`${e.id} has unknown manager ${e.managerId}`);
  const roots = c.employees.filter((e) => !e.managerId);
  if (roots.length !== 1) problems.push(`reporting tree has ${roots.length} roots, expected 1`);
  for (const sv of c.services) {
    if (!ids.has(sv.primaryOwnerId) || !ids.has(sv.secondaryOwnerId)) problems.push(`${sv.id} owner missing`);
    if (sv.primaryOwnerId === sv.secondaryOwnerId) problems.push(`${sv.id} primary equals secondary`);
  }
  const owners = new Set(c.services.flatMap((s) => [s.primaryOwnerId, s.secondaryOwnerId]));
  for (const e of c.employees.filter((x) => x.planted?.startsWith("decoy_"))) {
    if (owners.has(e.id)) problems.push(`decoy ${e.id} owns a service`);
    if (!c.employeeSkills.some((s) => s.employeeId === e.id && s.source === "profile" && s.proficiency >= 3)) problems.push(`decoy ${e.id} has no profile keyword`);
  }
  for (const sc of c.scenarios) {
    if (sc.expectId !== "doc" && !ids.has(sc.expectId)) problems.push(`${sc.id} expects unknown ${sc.expectId}`);
    if (sc.docId && !c.documents.some((d) => d.id === sc.docId)) problems.push(`${sc.id} doc ${sc.docId} missing`);
  }
  for (const rec of [...c.employees, ...c.services, ...c.documents]) {
    if (rec.embedding.length !== c.embedding.dims) problems.push(`${rec.id} embedding has ${rec.embedding.length} dims`);
  }
  const text = JSON.stringify(c);
  if (/[–—]/.test(text)) problems.push("fixture text contains an em or en dash"); // rules-allow
  return problems;
}

/** The team def for a team display name, for callers outside the generator. */
export function teamByName(name: string): TeamDef | undefined {
  return TEAMS.find((t) => t.name === name);
}
