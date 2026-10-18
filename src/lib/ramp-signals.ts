import "server-only";
// The ramp plan's inputs, decided by code: the owner's ask history, the skill gaps it points at,
// and short pools of real rows (documents, colleagues, projects) for each part of the plan. The
// ramp_plan model call only picks from these pools and writes the sentences. No session or next/*
// imports, so scripts (pnpm ramp:check) can run it.
//
// Gap score per skill (RAMP_CONFIG):
//   askSkill x asks that named the skill + askService x asks about a service that uses it
//   + teamCore when it is a core skill of the owner's team and not one they said they know
//   (a bonus only: a gap needs at least one ask behind it)
//   then x knownFactor when they know it, x dismissFactor per dismissed item that was for it.

import { and, eq, inArray, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { TEAMS } from "@/seed/catalog";
import { loadsThisWeek } from "./availability";
import { createLogger } from "./log";
import type { RampGap, RampHistory } from "./ramp-types";
import { normalizeUnderstanding } from "./understanding";

const log = createLogger("ramp.signals");

export const RAMP_CONFIG = {
  askSkill: 3,
  askService: 1,
  teamCore: 1,
  knownFactor: 0.4,
  dismissFactor: 0.5,
  maxGaps: 3,
  /** A person you learn from or meet needs real evidence, not a profile keyword. */
  evidenceSources: ["owns_service", "project", "authored_doc"] as const,
  minProficiency: 3,
  /** A document that failed this many asks across the company is offered last. */
  failingDocAt: 5,
  poolLearn: 6,
  poolStretch: 3,
  poolMeet: 3,
} as const;

/** What the owner played and who they are in the company. */
export type RampOwner = {
  owner: string;
  userId: string | null;
  visitorId: string | null;
  personaId: string;
  knownSkillIds: string[] | null;
  /** pnpm ramp:check only: a made-up history and dismissals instead of the database rows. */
  offline?: { asks: Array<{ id: string; status: string; understanding: unknown }>; dismissed: Array<{ refId: string; skillId: string | null }> };
};

/** One pool entry: a real row, the gap it serves, and the facts a sentence about it may use. */
/** meta holds the short names the demo sentences are filled from (all of them also appear in facts). */
export type RampCandidate = { ref: string; kind: "document" | "employee" | "project"; title: string; subtitle: string; skillId: string | null; facts: string[]; score: number; meta: Record<string, string> };

export type RampSignals = {
  persona: { id: string; name: string; firstName: string; team: string; department: string; daysIn: number | null; timezone: string };
  history: RampHistory;
  gaps: RampGap[];
  pools: { learn: RampCandidate[]; stretch: RampCandidate[]; meet: RampCandidate[] };
  missing: { stretch?: string; meet?: string; learn?: string };
  dismissed: Array<{ refId: string; skillId: string | null }>;
  /** Stable text of everything the plan depends on except dismissals (for the signature). */
  basis: string;
};

const DAY_MS = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function gatherRampSignals(o: RampOwner, now: Date): Promise<RampSignals | null> {
  const [persona] = await q("ramp.persona", (db) =>
    db
      .select({ id: t.employees.id, name: t.employees.name, team: t.employees.team, department: t.employees.department, startDate: t.employees.startDate, managerId: t.employees.managerId, timezone: t.employees.timezone })
      .from(t.employees)
      .where(eq(t.employees.id, o.personaId))
      .limit(1),
  );
  if (!persona) {
    log.warn(`ramp: persona ${o.personaId} not found (company reseeded?)`);
    return null;
  }
  const startMs = Date.parse(`${persona.startDate}T00:00:00Z`);
  const daysIn = Number.isFinite(startMs) ? Math.max(0, Math.floor((now.getTime() - startMs) / DAY_MS)) : null;
  const ownerCol = o.userId ? eq(t.asks.userId, o.userId) : o.visitorId ? eq(t.asks.visitorId, o.visitorId) : null;

  const [asks, services, skills, dismissed, mentorships, personaSkills] = await Promise.all([
    o.offline
      ? Promise.resolve(o.offline.asks.map((a) => ({ ...a, routedToId: null, answeredVia: null, answeredDocId: null })))
      : ownerCol
      ? q("ramp.asks", (db) =>
          db
            .select({ id: t.asks.id, status: t.asks.status, understanding: t.asks.understanding, routedToId: t.asks.routedToId, answeredVia: t.asks.answeredVia, answeredDocId: t.asks.answeredDocId })
            .from(t.asks)
            .where(and(ownerCol, sql`${t.asks.status} not in ('draft', 'understanding', 'confirming')`))
            .orderBy(t.asks.createdAt),
        )
      : Promise.resolve([]),
    q("ramp.services", (db) => db.select({ id: t.services.id, name: t.services.name, team: t.services.team, skillIds: t.services.skillIds, primary: t.services.primaryOwnerId, secondary: t.services.secondaryOwnerId }).from(t.services)),
    q("ramp.skills", (db) => db.select({ id: t.skills.id, name: t.skills.name }).from(t.skills)),
    o.offline ? Promise.resolve(o.offline.dismissed) : q("ramp.dismissed", (db) => db.select({ refId: t.rampDismissals.refId, skillId: t.rampDismissals.skillId }).from(t.rampDismissals).where(eq(t.rampDismissals.owner, o.owner))),
    q("ramp.mentorships", (db) => db.select({ mentorId: t.mentorships.mentorId, menteeId: t.mentorships.menteeId }).from(t.mentorships).where(sql`${t.mentorships.mentorId} = ${o.personaId} or ${t.mentorships.menteeId} = ${o.personaId}`)),
    q("ramp.persona_skills", (db) => db.select({ id: t.employeeSkills.skillId, proficiency: t.employeeSkills.proficiency }).from(t.employeeSkills).where(eq(t.employeeSkills.employeeId, o.personaId))),
  ]);
  if (!ownerCol && !o.offline) log.skip("ramp asks", "signed-out visitor without a visitor cookie has made no asks");

  const skillName = new Map(skills.map((s) => [s.id, s.name]));
  const svcById = new Map(services.map((s) => [s.id, s]));
  const askIds = asks.map((a) => a.id);

  // --- history ------------------------------------------------------------
  const askSvc = new Map<string, string[]>();
  const askSkl = new Map<string, string[]>();
  for (const a of asks) {
    const u = normalizeUnderstanding(a.understanding);
    askSvc.set(a.id, [...new Set((u?.services ?? []).map((s) => s.id).filter((id) => svcById.has(id)))]);
    askSkl.set(a.id, [...new Set((u?.skills ?? []).map((s) => s.id).filter((id) => skillName.has(id)))]);
  }
  const count = (m: Map<string, string[]>) => {
    const c = new Map<string, string[]>();
    for (const [askId, ids] of m) for (const id of ids) c.set(id, [...(c.get(id) ?? []), askId]);
    return c;
  };
  const svcAsks = count(askSvc);
  const sklAsks = count(askSkl);
  const history: RampHistory = {
    asks: asks.length,
    askIds,
    services: [...svcAsks.entries()].map(([id, a]) => ({ id, name: svcById.get(id)!.name, asks: a.length })).sort((x, y) => y.asks - x.asks || x.name.localeCompare(y.name)),
    skills: [...sklAsks.entries()].map(([id, a]) => ({ id, name: skillName.get(id)!, asks: a.length })).sort((x, y) => y.asks - x.asks || x.name.localeCompare(y.name)),
  };
  log.info(`ramp history for ${o.owner} as ${persona.id}: ${plural(asks.length, "confirmed ask")}; services ${history.services.map((s) => `${s.name}x${s.asks}`).join(", ") || "none"}; skills ${history.skills.map((s) => `${s.name}x${s.asks}`).join(", ") || "none"}`);

  // --- gaps -----------------------------------------------------------------
  const known = new Set(o.knownSkillIds ?? personaSkills.filter((s) => s.proficiency >= 2).map((s) => s.id));
  if (!o.knownSkillIds) log.branch("known skills from the persona (proficiency 2+)", "no onboarding profile with known skills");
  const teamDef = TEAMS.find((x) => x.name === persona.team);
  const teamCore = new Set((teamDef?.core ?? []).map((k) => `skl_${k}`));
  if (!teamDef) log.skip("team core skills", `no catalog team named ${persona.team}`);
  const dismissFor = new Map<string, number>();
  for (const d of dismissed) if (d.skillId) dismissFor.set(d.skillId, (dismissFor.get(d.skillId) ?? 0) + 1);

  const C = RAMP_CONFIG;
  const gapsAll: RampGap[] = [];
  for (const s of skills) {
    const viaSkill = sklAsks.get(s.id) ?? [];
    const viaSvc = [...svcAsks.entries()].filter(([sid]) => svcById.get(sid)!.skillIds.includes(s.id));
    const viaSvcAsks = [...new Set(viaSvc.flatMap(([, a]) => a))].filter((a) => !viaSkill.includes(a));
    const core = teamCore.has(s.id) && !known.has(s.id);
    let score = C.askSkill * viaSkill.length + C.askService * viaSvcAsks.length + (core ? C.teamCore : 0);
    if (score <= 0) continue;
    const isKnown = known.has(s.id);
    if (isKnown) score *= C.knownFactor;
    const d = dismissFor.get(s.id) ?? 0;
    if (d) score *= C.dismissFactor ** d;
    const signals: string[] = [];
    if (viaSkill.length) signals.push(`${s.name} came up in ${plural(viaSkill.length, "of your asks", "of your asks")} (${viaSkill.join(", ")})`);
    if (viaSvcAsks.length) signals.push(`${viaSvc.map(([sid]) => svcById.get(sid)!.name).join(" and ")} ${viaSvc.length === 1 ? "uses" : "use"} ${s.name}, and ${plural(viaSvcAsks.length, "of your asks", "of your asks")} ${viaSvcAsks.length === 1 ? "was" : "were"} about ${viaSvc.length === 1 ? "it" : "them"} (${viaSvcAsks.join(", ")})`);
    if (core) signals.push(`${s.name} is a core skill on the ${persona.team} team and is not in your known skills`);
    if (isKnown) signals.push(`you said you already know ${s.name}, so it counts for less`);
    if (d) signals.push(`you dismissed ${plural(d, "earlier suggestion")} for ${s.name}`);
    gapsAll.push({ skillId: s.id, name: s.name, score: Math.round(score * 10) / 10, signals, askIds: [...new Set([...viaSkill, ...viaSvcAsks])] });
  }
  gapsAll.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // A gap needs at least one ask behind it: team core skills alone never make a plan. Greedy, so
  // the gaps cover different asks when scores are close (a gap whose asks are all covered loses 1).
  const gaps: RampGap[] = [];
  const backed = gapsAll.filter((g) => g.askIds.length > 0);
  while (gaps.length < C.maxGaps && backed.length) {
    const covered = new Set(gaps.flatMap((g) => g.askIds));
    const eff = (g: RampGap) => g.score - (g.askIds.every((a) => covered.has(a)) ? 1 : 0);
    backed.sort((a, b) => eff(b) - eff(a) || b.score - a.score || a.name.localeCompare(b.name));
    gaps.push(backed.shift()!);
  }
  for (const g of gapsAll.slice(0, 8)) log.info(`ramp gap ${g.skillId} ${g.name} score ${g.score}${gaps.includes(g) ? " KEPT" : ""}: ${g.signals.join("; ")}`);

  const basis = JSON.stringify({ persona: persona.id, team: persona.team, known: [...known].sort(), asks: asks.map((a) => [a.id, a.status, askSvc.get(a.id), askSkl.get(a.id)]) });
  const dismissedRefs = new Set(dismissed.map((d) => d.refId));
  const out: RampSignals = {
    persona: { id: persona.id, name: persona.name, firstName: persona.name.split(" ")[0], team: persona.team, department: persona.department, daysIn, timezone: persona.timezone },
    history,
    gaps,
    pools: { learn: [], stretch: [], meet: [] },
    missing: {},
    dismissed,
    basis,
  };
  if (!gaps.length) {
    log.branch("no pools", "no skill gap is backed by an ask");
    return out;
  }
  const gapIds = gaps.map((g) => g.skillId);
  const gapName = (id: string | null) => (id ? (skillName.get(id) ?? id) : "");
  const touched = new Set(svcAsks.keys());

  // --- who the owner already interacted with ---------------------------------
  const sentTo = askIds.length
    ? await q("ramp.sent_to", (db) =>
        db.execute<{ id: string }>(sql`
          select distinct coalesce(e.data->>'recipientId', a.routed_to_id) as id from ask_events e join asks a on a.id = e.ask_id
          where e.ask_id in ${askIds} and e.to_state = 'sent'
          union select employee_id from ask_candidates where ask_id in ${askIds} and chosen`),
      )
    : [];
  const interacted = new Set<string>([persona.id, ...(persona.managerId ? [persona.managerId] : []), ...sentTo.map((r) => r.id).filter(Boolean), ...mentorships.flatMap((m) => [m.mentorId, m.menteeId])]);
  log.debug(`ramp: ${interacted.size - 1} people already interacted with (manager, sent to, chosen, mentorships)`, { ids: [...interacted] });

  // --- learn: documents and people per gap ------------------------------------
  const [docs, experts, docFails, docVerdicts] = await Promise.all([
    q("ramp.docs", (db) =>
      db
        .select({ id: t.documents.id, title: t.documents.title, kind: t.documents.kind, serviceId: t.documents.serviceId, authorName: t.employees.name })
        .from(t.documents)
        .innerJoin(t.employees, eq(t.employees.id, t.documents.authorId))
        .where(sql`${t.documents.serviceId} is not null`),
    ),
    q("ramp.experts", (db) =>
      db
        .select({ id: t.employees.id, name: t.employees.name, title: t.employees.title, team: t.employees.team, department: t.employees.department, isMentor: t.employees.isMentor, max: t.employees.maxWeeklyAsks, skillId: t.employeeSkills.skillId, proficiency: t.employeeSkills.proficiency, source: t.employeeSkills.source, evidence: t.employeeSkills.evidence })
        .from(t.employeeSkills)
        .innerJoin(t.employees, eq(t.employees.id, t.employeeSkills.employeeId))
        .where(and(inArray(t.employeeSkills.skillId, gapIds), inArray(t.employeeSkills.source, [...C.evidenceSources]), sql`${t.employeeSkills.proficiency} >= ${C.minProficiency}`)),
    ),
    q("ramp.doc_failures", (db) => db.execute<{ id: string; n: number }>(sql`select document_id as id, count(*)::int as n from ask_doc_checks where verdict = 'not_answered' group by 1`)),
    askIds.length ? q("ramp.own_doc_verdicts", (db) => db.select({ id: t.askDocChecks.documentId, verdict: t.askDocChecks.verdict }).from(t.askDocChecks).where(inArray(t.askDocChecks.askId, askIds))) : Promise.resolve([]),
  ]);
  const failsBy = new Map([...docFails].map((r) => [r.id, r.n]));
  const ownVerdict = new Map(docVerdicts.map((v) => [v.id, v.verdict]));
  const peopleIds = [...new Set(experts.map((e) => e.id))];

  // Owners of the services the owner asked about, for "someone worth meeting".
  const ownerIds = [...new Set([...touched].flatMap((sid) => [svcById.get(sid)!.primary, svcById.get(sid)!.secondary]))];
  const ownerRows = ownerIds.length
    ? await q("ramp.owners", (db) => db.select({ id: t.employees.id, name: t.employees.name, title: t.employees.title, team: t.employees.team, department: t.employees.department, isMentor: t.employees.isMentor, max: t.employees.maxWeeklyAsks }).from(t.employees).where(inArray(t.employees.id, ownerIds)))
    : [];
  const allPeople = [...new Set([...peopleIds, ...ownerIds])];
  const [loads, ooo] = await Promise.all([
    loadsThisWeek(allPeople, now),
    allPeople.length
      ? q("ramp.ooo", (db) =>
          db.execute<{ id: string }>(sql`select distinct employee_id as id from calendar_events where kind = 'ooo' and employee_id in ${allPeople} and starts_at < ${new Date(now.getTime() + 5 * DAY_MS).toISOString()}::timestamptz and ends_at > ${now.toISOString()}::timestamptz`),
        )
      : Promise.resolve([]),
  ]);
  const away = new Set([...ooo].map((r) => r.id));
  const maxOf = new Map([...experts, ...ownerRows].map((e) => [e.id, e.max]));
  const reachable = (id: string, what: string) => {
    const load = loads.get(id) ?? 0;
    const max = maxOf.get(id) ?? 3;
    if (away.has(id)) {
      log.skip(`ramp ${what} ${id}`, "out of office in the next 5 days");
      return false;
    }
    if (load >= max) {
      log.skip(`ramp ${what} ${id}`, `at their weekly ask limit (${load} of ${max})`);
      return false;
    }
    return true;
  };

  const learn: RampCandidate[] = [];
  for (const g of gaps) {
    const svcsForGap = services.filter((s) => s.skillIds.includes(g.skillId));
    const docCands = docs
      .filter((d) => svcsForGap.some((s) => s.id === d.serviceId) && !dismissedRefs.has(d.id))
      .filter((d) => {
        const v = ownVerdict.get(d.id);
        if (v) log.skip(`ramp doc ${d.id}`, v === "answered" ? "it already answered one of your asks" : "you said it did not answer one of your asks");
        return !v;
      })
      .map((d) => {
        const svc = svcById.get(d.serviceId!)!;
        const fails = failsBy.get(d.id) ?? 0;
        const score = (d.kind === "onboarding" || d.kind === "how_to" ? 2 : 1) + (touched.has(svc.id) ? 2 : 0) - (fails >= C.failingDocAt ? 1.5 : 0);
        const facts = [`${d.title} is ${KIND_PHRASE[d.kind]} about ${svc.name}, written by ${d.authorName}`, `${svc.name} uses ${g.name}`];
        if (touched.has(svc.id)) facts.push(`${plural(svcAsks.get(svc.id)!.length, "of your asks", "of your asks")} ${svcAsks.get(svc.id)!.length === 1 ? "was" : "were"} about ${svc.name} (${svcAsks.get(svc.id)!.join(", ")})`);
        if (fails >= C.failingDocAt) facts.push(`${d.title} did not answer ${fails} asks across the company`);
        return { ref: d.id, kind: "document" as const, title: d.title, subtitle: `${d.kind.replace("_", " ")} about ${svc.name}`, skillId: g.skillId, facts, score, meta: { skill: g.name, service: svc.name, author: d.authorName, kindNoun: KIND_PHRASE[d.kind].replace(/^an? /, "") } };
      })
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
    const personCands = experts
      .filter((e) => e.skillId === g.skillId && !dismissedRefs.has(e.id) && e.id !== persona.id && reachable(e.id, "learn person"))
      .map((e) => {
        const score = e.proficiency + (e.isMentor ? 1.5 : 0) + (e.department === persona.department ? 1 : 0) + (e.team === persona.team ? 0.5 : 0);
        const facts = [`${e.name} is ${e.title} on ${e.team}`, `${e.name}: ${e.evidence}`, `${g.name} proficiency ${e.proficiency} of 5`];
        if (e.isMentor) facts.push(`${e.name} is a mentor`);
        facts.push(`${e.name} has room this week (${loads.get(e.id) ?? 0} of ${e.max} asks)`);
        return { ref: e.id, kind: "employee" as const, title: e.name, subtitle: `${e.title}, ${e.team}`, skillId: g.skillId, facts, score, meta: { skill: g.name, first: e.name.split(" ")[0], evidence: lowerFirst(e.evidence.trim().replace(/[.]+$/, "")) } };
      })
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
    log.debug(`ramp learn pool for ${g.name}: ${docCands.length} docs, ${personCands.length} people`, { docs: docCands.slice(0, 3).map((d) => d.ref), people: personCands.slice(0, 3).map((p) => p.ref) });
    // One document and one person per gap, skipping any already picked for an earlier gap.
    const fresh = (c: RampCandidate) => !learn.some((l) => l.ref === c.ref);
    learn.push(...docCands.filter(fresh).slice(0, 1), ...personCands.filter(fresh).slice(0, 1));
  }
  out.pools.learn = learn.slice(0, C.poolLearn);
  if (!out.pools.learn.length) out.missing.learn = "No document or colleague in the company covers the skills your asks point at.";

  // --- stretch: open projects on the owner's team ------------------------------
  const projects = await q("ramp.projects", (db) =>
    db
      .select({ id: t.projects.id, name: t.projects.name, description: t.projects.description, serviceId: t.projects.serviceId })
      .from(t.projects)
      .where(and(eq(t.projects.team, persona.team), eq(t.projects.status, "active"))),
  );
  const members = projects.length
    ? await q("ramp.project_members", (db) =>
        db
          .select({ projectId: t.projectMembers.projectId, id: t.employees.id, name: t.employees.name, role: t.projectMembers.role })
          .from(t.projectMembers)
          .innerJoin(t.employees, eq(t.employees.id, t.projectMembers.employeeId))
          .where(inArray(t.projectMembers.projectId, projects.map((p) => p.id))),
      )
    : [];
  out.pools.stretch = projects
    .filter((p) => {
      if (dismissedRefs.has(p.id)) log.skip(`ramp stretch ${p.id}`, "dismissed earlier");
      return !dismissedRefs.has(p.id);
    })
    .map((p) => {
      const svc = p.serviceId ? svcById.get(p.serviceId) : undefined;
      const overlap = svc ? gaps.filter((g) => svc.skillIds.includes(g.skillId)) : [];
      const lead = members.find((m) => m.projectId === p.id && m.role === "lead");
      const mine = members.some((m) => m.projectId === p.id && m.id === persona.id);
      const score = overlap.length * 2 + (svc && touched.has(svc.id) ? 2 : 0) + (mine ? 0.5 : 0);
      const facts = [`${p.name} is an active project on the ${persona.team} team: ${p.description}`];
      if (svc) facts.push(`${p.name} works on ${svc.name}${overlap.length ? `, which uses ${overlap.map((g) => g.name).join(" and ")}` : ""}`);
      if (lead) facts.push(`${lead.name} leads ${p.name}`);
      if (mine) facts.push(`you are already a member of ${p.name}`);
      return {
        ref: p.id,
        kind: "project" as const,
        title: p.name,
        subtitle: svc ? `${persona.team} team, on ${svc.name}` : `${persona.team} team`,
        skillId: overlap[0]?.skillId ?? null,
        facts,
        score,
        meta: { ...(lead ? { lead: lead.name.split(" ")[0] } : {}), ...(svc ? { service: svc.name } : {}), ...(overlap[0] ? { skill: overlap[0].name } : {}) },
      };
    })
    .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
    .slice(0, C.poolStretch);
  if (!out.pools.stretch.length) out.missing.stretch = projects.length ? `You dismissed every open project on the ${persona.team} team.` : `The ${persona.team} team has no open projects right now, so there is no stretch task to draw from.`;

  // --- meet: someone not interacted with yet -----------------------------------
  const meetPool = new Map<string, RampCandidate>();
  for (const r of ownerRows) {
    // Someone already on the learn list is not offered again as the person to meet.
    if (interacted.has(r.id) || dismissedRefs.has(r.id) || out.pools.learn.some((l) => l.ref === r.id) || !reachable(r.id, "meet")) continue;
    const owns = [...touched].filter((sid) => [svcById.get(sid)!.primary, svcById.get(sid)!.secondary].includes(r.id));
    const facts = [`${r.name} is ${r.title} on ${r.team}`, ...owns.map((sid) => `${r.name} is the ${svcById.get(sid)!.primary === r.id ? "primary" : "backup"} owner of ${svcById.get(sid)!.name}, which ${plural(svcAsks.get(sid)!.length, "of your asks", "of your asks")} ${svcAsks.get(sid)!.length === 1 ? "was" : "were"} about`), `you have not asked ${r.name} anything yet`];
    if (r.isMentor) facts.push(`${r.name} is a mentor`);
    meetPool.set(r.id, { ref: r.id, kind: "employee", title: r.name, subtitle: `${r.title}, ${r.team}`, skillId: null, facts, score: 3 * owns.length + (r.isMentor ? 1 : 0) + (r.team !== persona.team ? 1 : 0), meta: { first: r.name.split(" ")[0] } });
  }
  for (const e of experts) {
    if (interacted.has(e.id) || dismissedRefs.has(e.id) || out.pools.learn.some((l) => l.ref === e.id) || !reachable(e.id, "meet")) continue;
    const cur = meetPool.get(e.id);
    const fact = `${e.name}: ${e.evidence}`;
    if (cur) {
      cur.facts.splice(cur.facts.length - 1, 0, fact);
      cur.score += 2;
      cur.skillId ??= e.skillId;
    } else {
      meetPool.set(e.id, {
        ref: e.id,
        kind: "employee",
        title: e.name,
        subtitle: `${e.title}, ${e.team}`,
        skillId: e.skillId,
        facts: [`${e.name} is ${e.title} on ${e.team}`, fact, `${gapName(e.skillId)} proficiency ${e.proficiency} of 5`, ...(e.isMentor ? [`${e.name} is a mentor`] : []), `you have not asked ${e.name} anything yet`],
        score: 2 + (e.isMentor ? 1 : 0) + (e.team !== persona.team ? 1 : 0),
        meta: { first: e.name.split(" ")[0] },
      });
    }
  }
  out.pools.meet = [...meetPool.values()].sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref)).slice(0, C.poolMeet);
  if (!out.pools.meet.length) out.missing.meet = "Everyone connected to your asks is someone you already asked, your manager, or busy this week.";

  for (const [k, pool] of Object.entries(out.pools)) log.info(`ramp pool ${k}: ${pool.map((c) => `${c.ref}(${c.score.toFixed(1)})`).join(", ") || "empty"}`);
  for (const [k, why] of Object.entries(out.missing)) log.branch(`ramp ${k} empty`, why);
  return out;
}

const lowerFirst = (x: string) => (x ? x[0].toLowerCase() + x.slice(1) : x);
const KIND_PHRASE: Record<string, string> = { onboarding: "an onboarding guide", runbook: "a runbook", how_to: "a how-to", reference: "a reference page" };
