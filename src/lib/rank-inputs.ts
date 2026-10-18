import "server-only";
// Gathers what ranking needs from the database and turns each retrieved candidate into Features
// (raw component values 0..1 with a detail fragment each). No session, no model, no writes, so
// scripts/check-ranking.ts runs the same code offline. The scoring itself is pure (src/lib/rank.ts).

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import type { AskUrgency } from "./ask-state";
import {
  type AvailabilityProvider,
  calendarAvailability,
  type EmployeeAvailability,
  horizonLabel,
  loadsThisWeek,
  logAvailability,
  overlapHoursBetween,
  type PreferredChannel,
  recommendChannel,
  toWindowView,
  windowLabel,
} from "./availability";
import { createLogger } from "./log";
import { type Component, type Features, firstName, RANK_CONFIG } from "./rank";
import type { Evidence } from "./retrieval-paths";
import { ZONE_LABEL } from "./time";
import type { Understanding } from "./understanding";

const log = createLogger("ask.rank");

export const SENIORITY_LEVEL: Record<string, number> = { junior: 0, mid: 1, senior: 2, staff: 3, principal: 4, manager: 3, director: 4, executive: 5 };

const SKILL_SOURCE_LABEL: Record<string, string> = {
  owns_service: "owning a service",
  project: "project work",
  authored_doc: "a doc they wrote",
  team: "their team's work",
  profile: "their profile only, self listed",
};

export type RankAsker = { employeeId: string | null; userId: string | null; visitorId: string | null };
export type RankProfile = { okToInterruptSeniors: boolean; knownSkillIds: string[]; preferredChannel: PreferredChannel; source: string };
export type CandidateIn = { employeeId: string; evidence: Evidence[] };

const ago = (d: number) => (d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
const stripPeriod = (s: string) => s.trim().replace(/[.]+$/, "");
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const r3 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;

/**
 * People this asker (account or visitor cookie) already got as their #1 within the cooldown window,
 * from asks.ranking on their other asks.
 */
export async function loadCooled(askId: string, asker: RankAsker, now: Date): Promise<Record<string, { askId: string; at: string }>> {
  const owner = asker.userId ? eq(t.asks.userId, asker.userId) : asker.visitorId ? eq(t.asks.visitorId, asker.visitorId) : null;
  if (!owner) {
    log.skip(`${askId} cooldown lookup`, "the ask has no account or visitor owner");
    return {};
  }
  const since = new Date(now.getTime() - RANK_CONFIG.guardrails.cooldownHours * 3600_000);
  const rows = await q("rank.cooldown", (db) =>
    db
      .select({ id: t.asks.id, topId: sql<string | null>`${t.asks.ranking}->>'topId'`, at: sql<string | null>`${t.asks.ranking}->>'rankedAt'` })
      .from(t.asks)
      .where(and(owner, sql`${t.asks.id} <> ${askId}`, sql`${t.asks.ranking}->>'topId' is not null`, sql`(${t.asks.ranking}->>'rankedAt')::timestamptz >= ${since.toISOString()}::timestamptz`)),
  );
  const out: Record<string, { askId: string; at: string }> = {};
  for (const r of rows.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))) if (r.topId && !out[r.topId]) out[r.topId] = { askId: r.id, at: r.at ?? "" };
  log.info(`${askId} cooldown: ${rows.length ? Object.entries(out).map(([id, v]) => `${id} was #1 on ${v.askId} at ${v.at}`).join("; ") : `no top suggestion for this asker in the last ${RANK_CONFIG.guardrails.cooldownHours}h`}`, { askId });
  return out;
}

export async function buildFeatures(args: {
  label: string;
  candidates: CandidateIn[];
  u: Understanding;
  asker: RankAsker;
  profile: RankProfile;
  urgency: AskUrgency;
  now: Date;
  availability?: AvailabilityProvider;
}): Promise<{ features: Features[]; askerTz: string; horizon: string; provider: string }> {
  const { label, candidates, u, asker, profile, urgency, now } = args;
  const provider = args.availability ?? calendarAvailability;
  const ids = candidates.map((c) => c.employeeId);
  const serviceIds = u.services.map((s) => s.id);
  const skillIds = u.skills.map((s) => s.id);
  const C = RANK_CONFIG;

  const [emps, services, mentorRows, skillRows] = await Promise.all([
    // All 200: the manager chain needs ancestors that are not candidates.
    q("rank.employees", (db) =>
      db
        .select({
          id: t.employees.id,
          name: t.employees.name,
          title: t.employees.title,
          team: t.employees.team,
          department: t.employees.department,
          seniority: t.employees.seniority,
          timezone: t.employees.timezone,
          managerId: t.employees.managerId,
          isMentor: t.employees.isMentor,
          maxWeeklyAsks: t.employees.maxWeeklyAsks,
        })
        .from(t.employees),
    ),
    serviceIds.length
      ? q("rank.services", (db) => db.select({ id: t.services.id, name: t.services.name, primary: t.services.primaryOwnerId, secondary: t.services.secondaryOwnerId }).from(t.services).where(inArray(t.services.id, serviceIds)))
      : Promise.resolve([]),
    ids.length
      ? q("rank.mentorships", (db) =>
          db
            .select({ mentorId: t.mentorships.mentorId, menteeId: t.mentorships.menteeId, active: sql<boolean>`${t.mentorships.endedOn} is null` })
            .from(t.mentorships)
            .where(or(inArray(t.mentorships.mentorId, ids), asker.employeeId ? and(eq(t.mentorships.menteeId, asker.employeeId), isNull(t.mentorships.endedOn)) : sql`false`)),
        )
      : Promise.resolve([]),
    ids.length && skillIds.length
      ? q("rank.skills", (db) =>
          db
            .select({ employeeId: t.employeeSkills.employeeId, skillId: t.employeeSkills.skillId, proficiency: t.employeeSkills.proficiency, source: t.employeeSkills.source })
            .from(t.employeeSkills)
            .where(and(inArray(t.employeeSkills.employeeId, ids), inArray(t.employeeSkills.skillId, skillIds))),
        )
      : Promise.resolve([]),
  ]);
  if (!skillIds.length) log.skip(`${label} skill rows`, "no skill was named or confirmed; skillMatch uses profile similarity only");

  const byId = new Map(emps.map((e) => [e.id, e]));
  const me = asker.employeeId ? byId.get(asker.employeeId) : undefined;
  if (!me) log.skip(`${label} asker-relative components`, "the ask has no persona; proximity is 0, seniority gap and time zone use defaults");
  const askerTz = me?.timezone ?? "America/Los_Angeles";
  const askerLevel = me ? (SENIORITY_LEVEL[me.seniority] ?? 0) : 0;
  const ancestors = (id: string | null | undefined) => {
    const out: string[] = [];
    let cur = id ? byId.get(id)?.managerId : null;
    for (let i = 0; cur && i < 8; i++) {
      out.push(cur);
      cur = byId.get(cur)?.managerId ?? null;
    }
    return out;
  };
  const myChain = ancestors(me?.id);
  // Owners of the asked services are checked too, even when retrieval did not bring them in, so
  // "DM the secondary owner instead" can be offered with their real load and calendar.
  const ownerIds = [...new Set(services.flatMap((s) => [s.primary, s.secondary]))].filter((id) => byId.has(id));
  const checkIds = [...new Set([...ids, ...ownerIds])];
  const [loadOf, avail] = await Promise.all([
    loadsThisWeek(checkIds, now),
    log.timed(`${label} availability via ${provider.name}`, () => provider.check({ label, employees: checkIds.map((id) => ({ id, timezone: byId.get(id)?.timezone ?? askerTz })), urgency, now })),
  ]);
  const horizon = horizonLabel(urgency);
  const prefersPeers = !profile.okToInterruptSeniors;
  log.branch(`${label} mentorFit peer share ${prefersPeers ? C.mentor.peerShare.prefersPeers : C.mentor.peerShare.okToInterrupt}`, prefersPeers ? `asker prefers peers first (${profile.source})` : `asker is fine interrupting seniors (${profile.source})`);

  const features: Features[] = [];
  for (const c of candidates) {
    const e = byId.get(c.employeeId);
    if (!e) {
      log.warn(`${label} candidate ${c.employeeId} has no employee row (reseeded since retrieval?), skipped`);
      continue;
    }
    const raw = {} as Record<Component, number>;
    const detail = {} as Record<Component, string>;

    // ownership
    const ownerOf: Features["ownerOf"] = services.flatMap((s): Features["ownerOf"] =>
      s.primary === e.id ? [{ serviceId: s.id, serviceName: s.name, role: "primary" }] : s.secondary === e.id ? [{ serviceId: s.id, serviceName: s.name, role: "secondary" }] : [],
    );
    const ev = c.evidence;
    const own = [
      ...ownerOf.map((o) => ({ v: o.role === "primary" ? C.ownership.primary : C.ownership.secondary, d: `${o.role === "primary" ? "primary" : "backup"} owner of ${o.serviceName}` })),
      ...ev.filter((x) => x.kind === "answered").map((x) => ({ v: C.ownership.answered, d: lowerFirst(stripPeriod(x.detail)) })),
      // "Is lead on ...", "Was reviewer on ...": the role is in the retrieval sentence.
      ...ev.filter((x) => x.kind === "project").map((x) => ({ v: C.ownership[/^(?:Is|Was) (\w+) on /.exec(x.detail)?.[1] ?? "contributor"] ?? C.ownership.contributor, d: lowerFirst(stripPeriod(x.detail)) })),
      ...ev.filter((x) => x.kind === "author").map((x) => ({ v: C.ownership.author, d: lowerFirst(stripPeriod(x.detail)) })),
    ].sort((a, b) => b.v - a.v);
    raw.ownership = own[0]?.v ?? 0;
    detail.ownership = own[0]?.d ?? "no ownership or work history on it";

    // skillMatch: mean over the asked skills of the best proficiency times source factor
    const mine = skillRows.filter((r) => r.employeeId === e.id);
    if (skillIds.length && mine.length) {
      let total = 0;
      let weightSum = 0;
      for (const sid of skillIds) {
        const w = profile.knownSkillIds.includes(sid) ? C.skill.knownByAskerFactor : 1;
        const r = mine.find((x) => x.skillId === sid);
        total += w * (r ? (r.proficiency / 5) * (C.skill.sourceFactor[r.source] ?? 0.5) : 0);
        weightSum += w;
      }
      raw.skillMatch = r3(total / weightSum);
      const best = [...mine].sort((a, b) => (b.proficiency / 5) * (C.skill.sourceFactor[b.source] ?? 0.5) - (a.proficiency / 5) * (C.skill.sourceFactor[a.source] ?? 0.5))[0];
      const name = u.skills.find((s) => s.id === best.skillId)?.name ?? best.skillId;
      detail.skillMatch = `${name} at level ${best.proficiency} of 5 from ${SKILL_SOURCE_LABEL[best.source] ?? best.source}${mine.length > 1 ? `, plus ${mine.length - 1} more of your skills` : ""}`;
    } else {
      const prof = ev.find((x) => x.kind === "profile");
      const sim = prof ? Number(/similarity (\d\.\d+)/.exec(prof.detail)?.[1] ?? 0) : 0;
      raw.skillMatch = r3(Math.min(C.skill.profileSimilarityCap, sim * C.skill.profileSimilarityCap * 2));
      detail.skillMatch = prof ? `profile reads close to your ask (similarity ${sim.toFixed(2)}), self written` : "no listed skill for this ask";
    }

    // recency: most recent dated work on the service or project
    const dated = ev.filter((x) => x.recencyDays !== null && x.kind !== "skill" && x.kind !== "profile").map((x) => x.recencyDays!);
    if (dated.length) {
      const days = Math.min(...dated);
      raw.recency = r3(Math.pow(0.5, days / C.recency.halfLifeDays));
      detail.recency = `last touched it ${ago(days)}`;
    } else {
      raw.recency = 0;
      detail.recency = "no dated work on it";
    }

    // availability: the urgency horizon scores it; the 14 day window and the channel come after the loop
    const full = avail.get(e.id);
    const a = full?.horizon;
    raw.availability = r3(a?.score ?? C.availability.unknown);
    const nextFreeLabel = a?.nextFree ? windowLabel(new Date(Math.max(a.nextFree.start.getTime(), now.getTime())), askerTz, e.timezone, now) : null;
    const focusNote = full?.softAllowed ? ", counting focus time as open because you are blocked right now" : "";
    detail.availability =
      a?.status === "free" && nextFreeLabel
        ? `free ${nextFreeLabel}${focusNote}`
        : a?.status === "ooo"
          ? `out of office for ${horizon}`
          : a?.status === "booked"
            ? `no free ${C.availability.minSlotMinutes[urgency]} minutes in ${horizon}${full?.window ? `, next open ${toWindowView(full, askerTz, now)?.label}` : ""}`
            : "calendar unknown for this window";

    // mentorFit
    const past = mentorRows.filter((m) => m.mentorId === e.id).length;
    const mentorsMe = !!me && mentorRows.some((m) => m.mentorId === e.id && m.menteeId === me.id && m.active);
    const mentorPart = Math.min(1, (e.isMentor ? C.mentor.isMentor : 0) + Math.min(past, C.mentor.maxPastMentees) * C.mentor.perPastMentee + (mentorsMe ? 0.3 : 0));
    const gap = Math.abs((SENIORITY_LEVEL[e.seniority] ?? 2) - askerLevel);
    const peerFit = C.mentor.seniorityGapFit[Math.min(gap, C.mentor.seniorityGapFit.length - 1)];
    const share = prefersPeers ? C.mentor.peerShare.prefersPeers : C.mentor.peerShare.okToInterrupt;
    raw.mentorFit = r3(mentorPart * (1 - share) + peerFit * share);
    detail.mentorFit = [
      mentorsMe ? "your mentor" : e.isMentor ? "a mentor" : null,
      past ? `${past} ${past === 1 ? "mentorship" : "mentorships"}` : null,
      gap === 0 ? "same level as you" : `${gap} ${gap === 1 ? "level" : "levels"} from you (${e.seniority})`,
    ]
      .filter(Boolean)
      .join(", ");

    // proximity
    const chain = me && (myChain.includes(e.id) || ancestors(e.id).includes(me.id) || (e.managerId && e.managerId === me.managerId));
    if (me && e.team === me.team) {
      raw.proximity = C.proximity.sameTeam;
      detail.proximity = `on your team (${e.team})`;
    } else if (chain) {
      raw.proximity = C.proximity.managerChain;
      detail.proximity = "in your manager chain";
    } else if (me && e.department === me.department) {
      raw.proximity = C.proximity.sameDepartment;
      detail.proximity = `in your department (${e.department})`;
    } else {
      raw.proximity = C.proximity.other;
      detail.proximity = `another department (${e.department})`;
    }

    // timezone: working hours overlap, both 9:00 to 17:30 local
    const overlap = overlapHoursBetween(askerTz, e.timezone, now);
    const tzFactor = C.timezone.urgencyFactor[urgency];
    raw.timezone = r3(1 - (1 - Math.min(1, overlap / C.timezone.fullOverlapHours)) * tzFactor);
    detail.timezone =
      e.timezone === askerTz
        ? `same time zone as you (${ZONE_LABEL[e.timezone] ?? e.timezone})`
        : `${overlap} working hours overlap with you (${ZONE_LABEL[e.timezone] ?? e.timezone})${tzFactor < 1 ? ", matters less for an ask that can wait" : ""}`;

    // loadPenalty: steep as they approach the cap
    const n = loadOf.get(e.id) ?? 0;
    const max = e.maxWeeklyAsks;
    raw.loadPenalty = max > 0 ? r3(Math.pow(Math.min(1, n / max), C.load.exponent)) : 1;
    detail.loadPenalty = `${n} of ${max} asks this week`;

    let excluded: Features["excluded"] = null;
    if (n >= max) excluded = { rule: "hard_cap", reason: max === 0 ? "takes no asks (weekly limit 0)" : `at their weekly ask limit (${n} of ${max} asks this week)` };
    else if (a?.status === "ooo") excluded = { rule: "out_of_office", reason: `out of office for ${horizon}` };

    features.push({
      employeeId: e.id,
      name: e.name,
      title: e.title,
      team: e.team,
      seniority: e.seniority,
      raw,
      detail,
      load: { count: n, max },
      availability: {
        status: a?.status ?? "unknown",
        nextFreeAt: a?.nextFree?.start.toISOString() ?? null,
        nextFreeLabel,
        horizonLabel: horizon,
        window: full ? toWindowView(full, askerTz, now) : null,
        windowReason: full?.reason,
        counts: full?.counts,
        recommendation: null,
      },
      ownerOf,
      excluded,
    });
  }
  recommendAll({ label, features, services, avail, loadOf, byId, urgency, askerTz, now, preferred: profile.preferredChannel });
  log.debug(`${label} features for ${features.length} candidates; asker ${me ? `${me.id} (${me.team}, ${me.seniority}, ${ZONE_LABEL[askerTz]})` : "unknown"}; first names ${features.map((f) => firstName(f.name)).join(", ")}`);
  return { features, askerTz, horizon, provider: provider.name };
}

/**
 * The channel recommendation for every candidate, with the other owners of the asked services as
 * the alternative for someone blocked right now. An owner at their weekly limit or out of office
 * is never offered as the alternative. One availability line per candidate.
 */
function recommendAll(x: {
  label: string;
  features: Features[];
  services: Array<{ id: string; name: string; primary: string; secondary: string }>;
  avail: Map<string, EmployeeAvailability>;
  loadOf: Map<string, number>;
  byId: Map<string, { id: string; name: string; maxWeeklyAsks: number }>;
  urgency: AskUrgency;
  askerTz: string;
  now: Date;
  preferred: PreferredChannel;
}): void {
  const owners = x.services.flatMap((s) =>
    (["primary", "secondary"] as const).map((role) => {
      const id = role === "primary" ? s.primary : s.secondary;
      const emp = x.byId.get(id);
      const a = x.avail.get(id);
      const blockedBy = !emp || !a ? "not loaded" : (x.loadOf.get(id) ?? 0) >= emp.maxWeeklyAsks ? "at their weekly limit" : a.horizon.status === "ooo" ? "out of office" : null;
      return { id, name: emp?.name ?? id, role, serviceId: s.id, serviceName: s.name, window: a ? toWindowView(a, x.askerTz, x.now) : null, blockedBy };
    }),
  );
  for (const o of owners.filter((o) => o.blockedBy)) log.branch(`${x.label} ${o.id} not offered as the other owner of ${o.serviceName}`, o.blockedBy!);
  for (const f of x.features) {
    const a = x.avail.get(f.employeeId);
    const view = f.availability.window ?? null;
    const mine = new Set(f.ownerOf.map((o) => o.serviceId));
    // The other owner of a service this person owns, else any owner of the asked services.
    const pool = owners.filter((o) => !o.blockedBy && o.id !== f.employeeId);
    const otherOwners = mine.size ? pool.filter((o) => mine.has(o.serviceId)) : pool;
    const rec = recommendChannel({ urgency: x.urgency, preferred: x.preferred, person: { id: f.employeeId, name: f.name, window: view }, otherOwners });
    f.availability.recommendation = rec;
    if (a) logAvailability(x.label, a, view, rec);
  }
}
