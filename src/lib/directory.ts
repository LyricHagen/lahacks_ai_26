import "server-only";
// Read model for /directory and /directory/[personId]. Every query goes through q() so each one
// is logged with its duration and row count.

import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { EMPLOYEE_ID_SQL, LOAD_WINDOW_DAYS, loadSqlFor } from "./availability";
import { createLogger } from "./log";

const log = createLogger("directory");

export const PAGE_SIZE = 50;
export { LOAD_WINDOW_DAYS };

export type DirectoryFilters = {
  q: string;
  department: string;
  team: string;
  timezone: string;
  mentor: "" | "yes";
  sort: "name" | "load" | "newest";
  page: number;
};

export function parseFilters(sp: Record<string, string | string[] | undefined>): DirectoryFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const sort = one("sort");
  const page = Number.parseInt(one("page"), 10);
  return {
    q: one("q").slice(0, 80),
    department: one("department"),
    team: one("team"),
    timezone: one("timezone"),
    mentor: one("mentor") === "yes" ? "yes" : "",
    sort: sort === "load" || sort === "newest" ? sort : "name",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

const ownsSql = sql<number>`(select count(*)::int from ${t.services} s where s.primary_owner_id = ${EMPLOYEE_ID_SQL} or s.secondary_owner_id = ${EMPLOYEE_ID_SQL})`;

/** `now` is app time (src/lib/clock.ts): load counts asks sent in the LOAD_WINDOW_DAYS before it. */
export async function listEmployees(f: DirectoryFilters, now: Date) {
  const loadSql = loadSqlFor(now);
  const conds: SQL[] = [];
  if (f.q) {
    const pat = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const skillMatch = q("directory.skillMatchIds", (db) =>
      db
        .select({ id: t.employeeSkills.employeeId })
        .from(t.employeeSkills)
        .innerJoin(t.skills, eq(t.skills.id, t.employeeSkills.skillId))
        .where(or(ilike(t.skills.name, pat), sql`exists (select 1 from unnest(${t.skills.aliases}) al where al ilike ${pat})`)),
    );
    const serviceMatch = q("directory.serviceMatchIds", (db) =>
      db
        .select({ a: t.services.primaryOwnerId, b: t.services.secondaryOwnerId })
        .from(t.services)
        .where(or(ilike(t.services.name, pat), ilike(t.services.repo, pat))),
    );
    const [skillRows, serviceRows] = await Promise.all([skillMatch, serviceMatch]);
    const ids = [...new Set([...skillRows.map((r) => r.id), ...serviceRows.flatMap((r) => [r.a, r.b])])];
    log.debug(`search "${f.q}" matched ${skillRows.length} skill rows and ${serviceRows.length} services`, { ids: ids.length });
    const textMatch = or(ilike(t.employees.name, pat), ilike(t.employees.title, pat), ilike(t.employees.team, pat), ilike(t.employees.id, pat), ilike(t.employees.slackHandle, pat));
    conds.push(ids.length ? or(textMatch, inArray(t.employees.id, ids))! : textMatch!);
  }
  if (f.department) conds.push(eq(t.employees.department, f.department));
  if (f.team) conds.push(eq(t.employees.team, f.team));
  if (f.timezone) conds.push(eq(t.employees.timezone, f.timezone));
  if (f.mentor === "yes") conds.push(eq(t.employees.isMentor, true));
  const where = conds.length ? and(...conds) : undefined;
  log.debug("directory filters", { ...f, conditions: conds.length });

  const order = f.sort === "load" ? [desc(loadSql), asc(t.employees.name)] : f.sort === "newest" ? [desc(t.employees.startDate), asc(t.employees.name)] : [asc(t.employees.name)];

  const [rows, [{ total }]] = await Promise.all([
    q("directory.list", (db) =>
      db
        .select({
          id: t.employees.id,
          name: t.employees.name,
          title: t.employees.title,
          department: t.employees.department,
          team: t.employees.team,
          timezone: t.employees.timezone,
          startDate: t.employees.startDate,
          isMentor: t.employees.isMentor,
          maxWeeklyAsks: t.employees.maxWeeklyAsks,
          load: loadSql,
          owns: ownsSql,
        })
        .from(t.employees)
        .where(where)
        .orderBy(...order)
        .limit(PAGE_SIZE)
        .offset((f.page - 1) * PAGE_SIZE),
    ),
    q("directory.count", (db) => db.select({ total: count() }).from(t.employees).where(where)),
  ]);
  return { rows, total: Number(total) };
}

export async function directoryFacets() {
  const [teams, total] = await Promise.all([
    q("directory.facets.teams", (db) =>
      db
        .select({ department: t.employees.department, team: t.employees.team, n: count() })
        .from(t.employees)
        .groupBy(t.employees.department, t.employees.team)
        .orderBy(asc(t.employees.department), asc(t.employees.team)),
    ),
    q("directory.facets.total", (db) => db.select({ n: count() }).from(t.employees)),
  ]);
  const departments = [...new Set(teams.map((r) => r.department))];
  return { teams, departments, totalEmployees: Number(total[0]?.n ?? 0) };
}

// ---------------------------------------------------------------------------
// One person
// ---------------------------------------------------------------------------

export async function getPerson(id: string, now: Date) {
  const [person] = await q("person.byId", (db) => db.select().from(t.employees).where(eq(t.employees.id, id)).limit(1));
  if (!person) return null;

  const weekAgo = new Date(now.getTime() - LOAD_WINDOW_DAYS * 86400_000);
  const weekAhead = new Date(now.getTime() + 7 * 86400_000);

  const [manager, reports, skills, owned, projects, mentoring, mentoredBy, asks, calendar, docs] = await Promise.all([
    person.managerId
      ? q("person.manager", (db) =>
          db.select({ id: t.employees.id, name: t.employees.name, title: t.employees.title }).from(t.employees).where(eq(t.employees.id, person.managerId!)).limit(1),
        )
      : Promise.resolve([]),
    q("person.reports", (db) =>
      db.select({ id: t.employees.id, name: t.employees.name, title: t.employees.title }).from(t.employees).where(eq(t.employees.managerId, id)).orderBy(asc(t.employees.name)),
    ),
    q("person.skills", (db) =>
      db
        .select({ skillId: t.skills.id, name: t.skills.name, category: t.skills.category, proficiency: t.employeeSkills.proficiency, source: t.employeeSkills.source, evidence: t.employeeSkills.evidence })
        .from(t.employeeSkills)
        .innerJoin(t.skills, eq(t.skills.id, t.employeeSkills.skillId))
        .where(eq(t.employeeSkills.employeeId, id))
        .orderBy(desc(t.employeeSkills.proficiency), asc(t.skills.name)),
    ),
    q("person.services", (db) =>
      db
        .select()
        .from(t.services)
        .where(or(eq(t.services.primaryOwnerId, id), eq(t.services.secondaryOwnerId, id)))
        .orderBy(asc(t.services.name)),
    ),
    q("person.projects", (db) =>
      db
        .select({
          id: t.projects.id,
          name: t.projects.name,
          description: t.projects.description,
          status: t.projects.status,
          role: t.projectMembers.role,
          startedOn: t.projectMembers.startedOn,
          endedOn: t.projectMembers.endedOn,
          serviceName: t.services.name,
        })
        .from(t.projectMembers)
        .innerJoin(t.projects, eq(t.projects.id, t.projectMembers.projectId))
        .leftJoin(t.services, eq(t.services.id, t.projects.serviceId))
        .where(eq(t.projectMembers.employeeId, id))
        .orderBy(desc(t.projectMembers.startedOn)),
    ),
    q("person.mentoring", (db) =>
      db
        .select({ id: t.mentorships.id, otherId: t.employees.id, otherName: t.employees.name, otherTitle: t.employees.title, focus: t.mentorships.focus, startedOn: t.mentorships.startedOn, endedOn: t.mentorships.endedOn })
        .from(t.mentorships)
        .innerJoin(t.employees, eq(t.employees.id, t.mentorships.menteeId))
        .where(eq(t.mentorships.mentorId, id))
        .orderBy(desc(t.mentorships.startedOn)),
    ),
    q("person.mentoredBy", (db) =>
      db
        .select({ id: t.mentorships.id, otherId: t.employees.id, otherName: t.employees.name, otherTitle: t.employees.title, focus: t.mentorships.focus, startedOn: t.mentorships.startedOn, endedOn: t.mentorships.endedOn })
        .from(t.mentorships)
        .innerJoin(t.employees, eq(t.employees.id, t.mentorships.mentorId))
        .where(eq(t.mentorships.menteeId, id))
        .orderBy(desc(t.mentorships.startedOn)),
    ),
    q("person.asksThisWeek", (db) =>
      db
        .select({ id: t.asks.id, title: t.asks.title, status: t.asks.status, createdAt: t.asks.createdAt, askerId: t.employees.id, askerName: t.employees.name })
        .from(t.asks)
        .leftJoin(t.employees, eq(t.employees.id, t.asks.askerEmployeeId))
        // Same rule as loadsThisWeek (src/lib/availability.ts): a sent transition to them is inside the window.
        .where(sql`exists (select 1 from ${t.askEvents} e where e.ask_id = ${t.asks.id} and e.to_state = 'sent' and coalesce(e.data->>'recipientId', ${t.asks.routedToId}) = ${id} and e.at >= ${weekAgo.toISOString()}::timestamptz)`)
        .orderBy(desc(t.asks.createdAt)),
    ),
    q("person.calendar", (db) =>
      db
        .select({ id: t.calendarEvents.id, title: t.calendarEvents.title, kind: t.calendarEvents.kind, startsAt: t.calendarEvents.startsAt, endsAt: t.calendarEvents.endsAt, busy: t.calendarEvents.busy })
        .from(t.calendarEvents)
        .where(and(eq(t.calendarEvents.employeeId, id), lt(t.calendarEvents.startsAt, weekAhead), gte(t.calendarEvents.endsAt, startOfUtcDay(now))))
        .orderBy(asc(t.calendarEvents.startsAt)),
    ),
    q("person.documents", (db) =>
      db
        .select({ id: t.documents.id, title: t.documents.title, kind: t.documents.kind, updatedOn: t.documents.updatedOn, serviceName: t.services.name })
        .from(t.documents)
        .leftJoin(t.services, eq(t.services.id, t.documents.serviceId))
        .where(eq(t.documents.authorId, id))
        .orderBy(desc(t.documents.updatedOn)),
    ),
  ]);

  const peerIds = [...new Set(owned.flatMap((s) => [s.primaryOwnerId, s.secondaryOwnerId]).filter((x) => x !== id))];
  const peers = peerIds.length
    ? await q("person.servicePeers", (db) => db.select({ id: t.employees.id, name: t.employees.name }).from(t.employees).where(inArray(t.employees.id, peerIds)))
    : [];
  const peerName = new Map(peers.map((p) => [p.id, p.name]));

  log.info(`loaded person ${id}`, {
    skills: skills.length,
    services: owned.length,
    projects: projects.length,
    mentoring: mentoring.length,
    mentoredBy: mentoredBy.length,
    asksThisWeek: asks.length,
    maxWeeklyAsks: person.maxWeeklyAsks,
    calendarEvents: calendar.length,
    documents: docs.length,
  });

  return {
    person,
    manager: manager[0] ?? null,
    reports,
    skills,
    services: owned.map((s) => ({
      ...s,
      role: s.primaryOwnerId === id ? ("primary" as const) : ("secondary" as const),
      otherOwnerId: s.primaryOwnerId === id ? s.secondaryOwnerId : s.primaryOwnerId,
      otherOwnerName: peerName.get(s.primaryOwnerId === id ? s.secondaryOwnerId : s.primaryOwnerId) ?? null,
    })),
    projects,
    mentoring,
    mentoredBy,
    asks,
    calendar,
    docs,
  };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type PersonDetail = NonNullable<Awaited<ReturnType<typeof getPerson>>>;

