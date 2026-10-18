import "server-only";
// Hybrid retrieval: who in the company could help with this ask, and the evidence for each.
// Six paths, each logged separately (query, rows, people, ms), because when a ranking looks
// wrong the first question is always which path brought the person in:
//
//   ownership   primary or secondary owner of a named service (strongest signal)
//   history     member of a project on a named service (or a project named in the ask), and
//               who answered seeded asks about the service; both with how recently
//   skill       employee_skills rows for the named skills, carrying the seed's evidence sentence
//   semantic    pgvector similarity between the ask and profile embeddings, for asks that do not
//               use the company's words (local embedding, never an API call)
//   authorship  wrote a document about a named service or close to the ask
//   manager     only when the five above found nobody: the asker's manager and skip-level, who
//               know who owns what. An ask about something the company data does not cover
//               (a badge reader, a parking spot) still gets a sensible person and a draft.
//
// Candidates are deduplicated, their evidence unioned, and capped at MAX_CANDIDATES. There are no
// scores here: ranking is the next step. The cap keeps the people with the most and strongest
// evidence, and logs who was cut. Planted roles (seed.planted) are never read.

import { and, cosineDistance, eq, inArray, ne, or, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { sharedWords } from "./doc-check";
import { findTerm, type Understanding } from "./understanding";
import { wallNow } from "./clock";
import { createLogger } from "./log";
import { type Candidate, type Evidence, PATH_LABEL, type PathSummary, RETRIEVAL_PATHS, type RetrievalPath, type RetrievalSummary } from "./retrieval-paths";

export * from "./retrieval-paths";

const log = createLogger("ask.retrieve");

export const MAX_CANDIDATES = 30;
const SKILL_ROWS = 40;
const SEMANTIC_POOL = 12;
/** Below this the profile only shares filler words with the ask. */
export const SEMANTIC_MIN = 0.18;
const DOC_POOL = 5;
const DOC_MIN = 0.3;

/** Relative weight used only to decide who survives the cap. Ranking (prompt 6) does the real scoring. */
const CAP_WEIGHT: Record<RetrievalPath, number> = { ownership: 5, history: 3, authorship: 2, skill: 2, semantic: 1, manager: 1 };

export function emptyRetrieval(): RetrievalSummary {
  return { version: 1, paths: [], total: null, beforeCap: null, cut: [], at: null };
}

type Emp = { id: string; name: string; title: string; team: string };

const DAY_MS = 86_400_000;
/** Whole days from d to now (app time, so seeded dates line up with the pinned demo clock). */
function daysSinceAt(now: Date, d: string | Date | null): number | null {
  if (!d) return null;
  const ms = typeof d === "string" ? Date.parse(`${d}T00:00:00Z`) : d.getTime();
  return Math.max(0, Math.floor((now.getTime() - ms) / DAY_MS));
}
function ago(days: number | null): string {
  if (days === null) return "at an unknown time";
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w === "person" ? "people" : `${w}s`}`;

export async function retrieveCandidates(args: {
  label: string;
  text: string;
  understanding: Understanding;
  embedding: number[];
  askerId: string | null;
  /** App time (src/lib/clock.ts): how long ago work happened is measured from here. */
  now: Date;
  /** Called after each path with the summary so far, so the page can show counts as they arrive. */
  onPath?: (summary: PathSummary, all: PathSummary[]) => Promise<void>;
}): Promise<{ candidates: Candidate[]; summary: RetrievalSummary }> {
  const { label, text, understanding: u, embedding, askerId, now } = args;
  const daysSince = (d: string | Date | null) => daysSinceAt(now, d);
  const serviceIds = u.services.map((s) => s.id);
  const skillIds = u.skills.map((s) => s.id);
  const pool = new Map<string, { emp: Emp; evidence: Evidence[] }>();
  const paths: PathSummary[] = [];
  const notAsker = (col: typeof t.employees.id) => (askerId ? ne(col, askerId) : undefined);

  const add = (emp: Emp, ev: Evidence) => {
    if (emp.id === askerId) return;
    const c = pool.get(emp.id) ?? { emp, evidence: [] };
    if (!c.evidence.some((e) => e.kind === ev.kind && e.detail === ev.detail)) c.evidence.push(ev);
    pool.set(emp.id, c);
  };

  async function runPath(path: RetrievalPath, query: string, skipReason: string | null, fn: () => Promise<{ rows: number; people: Set<string>; note?: string }>) {
    const t0 = performance.now();
    let s: PathSummary;
    if (skipReason) {
      log.skip(`${label} path ${path}`, skipReason);
      s = { path, label: PATH_LABEL[path], status: "skipped", query, rows: 0, people: 0, ms: 0, note: skipReason };
    } else {
      const r = await fn();
      const ms = Math.round(performance.now() - t0);
      s = { path, label: PATH_LABEL[path], status: "done", query, rows: r.rows, people: r.people.size, ms, ...(r.note ? { note: r.note } : {}) };
      log.info(`${label} path ${path}: ${query} -> ${plural(r.rows, "row")}, ${plural(r.people.size, "person")} in ${ms}ms`, { path, rows: r.rows, people: [...r.people] });
    }
    paths.push(s);
    await args.onPath?.(s, [...paths]);
  }

  const services = serviceIds.length
    ? await q("ask.retrieve.services", (db) =>
        db.select({ id: t.services.id, name: t.services.name, repo: t.services.repo, primary: t.services.primaryOwnerId, secondary: t.services.secondaryOwnerId }).from(t.services).where(inArray(t.services.id, serviceIds)),
      )
    : [];
  const svcName = new Map(services.map((s) => [s.id, s.name]));

  // Seeded asks routed to someone about a named service. The fixture's service id lives in the
  // seeded candidate row's breakdown (src/seed/load.ts), so this reads it from there.
  const answered = serviceIds.length
    ? await q("ask.retrieve.answered", (db) =>
        db
          .select({ employeeId: t.askCandidates.employeeId, serviceId: sql<string>`${t.askCandidates.breakdown}->>'serviceId'`, n: sql<number>`count(*)::int`, last: sql<Date>`max(${t.asks.createdAt})` })
          .from(t.askCandidates)
          .innerJoin(t.asks, eq(t.asks.id, t.askCandidates.askId))
          .where(and(eq(t.askCandidates.chosen, true), sql`${t.askCandidates.breakdown}->>'serviceId' in ${serviceIds}`))
          .groupBy(t.askCandidates.employeeId, sql`${t.askCandidates.breakdown}->>'serviceId'`),
      )
    : [];
  const answeredOf = (emp: string, svc: string) => answered.find((a) => a.employeeId === emp && a.serviceId === svc);

  const empCols = { id: t.employees.id, name: t.employees.name, title: t.employees.title, team: t.employees.team };
  const loadEmps = async (ids: string[]) =>
    ids.length ? new Map((await q("ask.retrieve.employees", (db) => db.select(empCols).from(t.employees).where(inArray(t.employees.id, [...new Set(ids)])))).map((e) => [e.id, e])) : new Map<string, Emp>();

  // 1. ownership
  await runPath("ownership", `services.primary_owner_id, secondary_owner_id for ${serviceIds.join(", ") || "(none)"}`, serviceIds.length ? null : "no service was named or confirmed", async () => {
    const emps = await loadEmps(services.flatMap((s) => [s.primary, s.secondary]));
    const people = new Set<string>();
    for (const s of services) {
      for (const [id, role] of [
        [s.primary, "primary"],
        [s.secondary, "secondary"],
      ] as const) {
        const emp = emps.get(id);
        if (!emp || id === askerId) continue;
        const a = answeredOf(id, s.id);
        const recency = a ? daysSince(new Date(a.last)) : null;
        add(emp, {
          kind: "owner",
          path: "ownership",
          detail: `${role === "primary" ? "Owns" : "Is the backup owner of"} ${s.name} (${s.repo})${a ? ` and answered ${plural(a.n, "ask")} about it in the last 21 days, most recently ${ago(recency)}` : ""}.`,
          source: `services.${role}_owner_id ${s.id}`,
          recencyDays: recency,
        });
        people.add(id);
      }
    }
    return { rows: services.length, people };
  });

  // 2. history: projects on the named services or named in the ask, plus answered asks
  const allProjects = await q("ask.retrieve.projects", (db) => db.select({ id: t.projects.id, name: t.projects.name, serviceId: t.projects.serviceId, status: t.projects.status, endedOn: t.projects.endedOn }).from(t.projects));
  const namedProjects = allProjects.filter((p) => findTerm(text, p.name));
  const projects = allProjects.filter((p) => (p.serviceId && serviceIds.includes(p.serviceId)) || namedProjects.includes(p));
  if (namedProjects.length) log.branch(`${label} include projects named in the ask`, namedProjects.map((p) => `${p.id} "${p.name}"`).join(", "));
  await runPath(
    "history",
    `project_members of ${projects.map((p) => p.id).join(", ") || "(none)"}; seeded asks answered about ${serviceIds.join(", ") || "(none)"}`,
    projects.length || answered.length ? null : "no project or answered ask touches a named service",
    async () => {
      const members = projects.length
        ? await q("ask.retrieve.members", (db) =>
            db
              .select({ projectId: t.projectMembers.projectId, role: t.projectMembers.role, startedOn: t.projectMembers.startedOn, endedOn: t.projectMembers.endedOn, ...empCols })
              .from(t.projectMembers)
              .innerJoin(t.employees, eq(t.employees.id, t.projectMembers.employeeId))
              .where(and(inArray(t.projectMembers.projectId, projects.map((p) => p.id)), notAsker(t.employees.id))),
          )
        : [];
      const people = new Set<string>();
      for (const m of members) {
        const p = projects.find((x) => x.id === m.projectId)!;
        const ended = m.endedOn ?? p.endedOn;
        const recency = ended ? daysSince(ended) : 0;
        const where = p.serviceId && svcName.get(p.serviceId) ? ` on ${svcName.get(p.serviceId)}` : "";
        add(
          { id: m.id, name: m.name, title: m.title, team: m.team },
          {
            kind: "project",
            path: "history",
            detail: ended ? `Was ${m.role} on ${p.name}${where} until ${ago(recency)}.` : `Is ${m.role} on ${p.name}${where}, joined ${ago(daysSince(m.startedOn))} and still active.`,
            source: `project_members ${p.id}`,
            recencyDays: recency,
          },
        );
        people.add(m.id);
      }
      const answerers = await loadEmps(answered.map((a) => a.employeeId));
      for (const a of answered) {
        const emp = answerers.get(a.employeeId);
        if (!emp || emp.id === askerId) continue;
        const recency = daysSince(new Date(a.last));
        add(emp, {
          kind: "answered",
          path: "history",
          detail: `Answered ${plural(a.n, "ask")} about ${svcName.get(a.serviceId) ?? a.serviceId} in the last 21 days, most recently ${ago(recency)}.`,
          source: `asks routed about ${a.serviceId}`,
          recencyDays: recency,
        });
        people.add(emp.id);
      }
      return { rows: members.length + answered.length, people };
    },
  );

  // 3. skill
  await runPath("skill", `employee_skills for ${skillIds.join(", ") || "(none)"}, top ${SKILL_ROWS} by proficiency`, skillIds.length ? null : "no skill was named or confirmed", async () => {
    const rows = await q("ask.retrieve.skills", (db) =>
      db
        .select({ skillId: t.employeeSkills.skillId, skillName: t.skills.name, proficiency: t.employeeSkills.proficiency, source: t.employeeSkills.source, evidence: t.employeeSkills.evidence, ...empCols })
        .from(t.employeeSkills)
        .innerJoin(t.skills, eq(t.skills.id, t.employeeSkills.skillId))
        .innerJoin(t.employees, eq(t.employees.id, t.employeeSkills.employeeId))
        .where(and(inArray(t.employeeSkills.skillId, skillIds), notAsker(t.employees.id)))
        .orderBy(sql`${t.employeeSkills.proficiency} desc`, t.employees.id)
        .limit(SKILL_ROWS),
    );
    const people = new Set<string>();
    for (const r of rows) {
      add(
        { id: r.id, name: r.name, title: r.title, team: r.team },
        { kind: "skill", path: "skill", detail: `${r.evidence} (${r.skillName}, level ${r.proficiency} of 5)`, source: `employee_skills ${r.skillId} from ${r.source}`, recencyDays: null },
      );
      people.add(r.id);
    }
    return { rows: rows.length, people, note: rows.length === SKILL_ROWS ? `capped at ${SKILL_ROWS} rows` : undefined };
  });

  // 4. semantic
  await runPath("semantic", `employees by cosine similarity to the ask embedding, top ${SEMANTIC_POOL}, at least ${SEMANTIC_MIN}`, embedding.length ? null : "the ask has no embedding", async () => {
    const rows = await q("ask.retrieve.semantic", (db) =>
      db
        .select({ ...empCols, bio: t.employees.bio, similarity: sql<number>`1 - (${cosineDistance(t.employees.embedding, embedding)})` })
        .from(t.employees)
        .where(notAsker(t.employees.id))
        .orderBy(cosineDistance(t.employees.embedding, embedding))
        .limit(SEMANTIC_POOL),
    );
    const people = new Set<string>();
    let below = 0;
    for (const r of rows) {
      const sim = Number(r.similarity);
      if (sim < SEMANTIC_MIN) {
        below++;
        continue;
      }
      const words = sharedWords(text, `${r.title} ${r.team} ${r.bio}`);
      add(
        { id: r.id, name: r.name, title: r.title, team: r.team },
        {
          kind: "profile",
          path: "semantic",
          detail: `Their profile reads close to your ask (similarity ${sim.toFixed(2)})${words.length ? `, sharing the words ${words.join(", ")}` : ""}.`,
          source: "employees.embedding w2a-hash-256-v1",
          recencyDays: null,
        },
      );
      people.add(r.id);
    }
    if (below) log.branch(`${label} semantic drop ${below} of ${rows.length}`, `similarity under ${SEMANTIC_MIN}`);
    return { rows: rows.length, people, note: below ? `${below} below ${SEMANTIC_MIN}` : undefined };
  });

  // 5. authorship
  await runPath("authorship", `documents about ${serviceIds.join(", ") || "(none)"} or top ${DOC_POOL} by similarity at least ${DOC_MIN}`, null, async () => {
    const sim = sql<number>`1 - (${cosineDistance(t.documents.embedding, embedding)})`;
    const rows = await q("ask.retrieve.authors", (db) =>
      db
        .select({ docId: t.documents.id, docTitle: t.documents.title, kind: t.documents.kind, serviceId: t.documents.serviceId, updatedOn: t.documents.updatedOn, similarity: sim, ...empCols })
        .from(t.documents)
        .innerJoin(t.employees, eq(t.employees.id, t.documents.authorId))
        .where(and(notAsker(t.employees.id), or(serviceIds.length ? inArray(t.documents.serviceId, serviceIds) : sql`false`, sql`${sim} >= ${DOC_MIN}`)))
        .orderBy(sql`${sim} desc`)
        .limit(DOC_POOL + serviceIds.length * 4),
    );
    const people = new Set<string>();
    for (const r of rows) {
      const recency = daysSince(r.updatedOn);
      const about = r.serviceId && svcName.get(r.serviceId) ? ` about ${svcName.get(r.serviceId)}` : "";
      add(
        { id: r.id, name: r.name, title: r.title, team: r.team },
        { kind: "author", path: "authorship", detail: `Wrote the ${r.kind.replace("_", " ")} "${r.docTitle}"${about}, updated ${ago(recency)}.`, source: `documents ${r.docId}`, recencyDays: recency },
      );
      people.add(r.id);
    }
    return { rows: rows.length, people };
  });

  // 6. manager: the last resort, only when nothing above matched anyone
  const matched = pool.size;
  await runPath("manager", `the asker's manager and skip-level`, matched ? `${plural(matched, "person")} matched, no fallback needed` : askerId ? null : "no asker persona to look up", async () => {
    const [me] = await q("ask.retrieve.asker", (db) => db.select({ managerId: t.employees.managerId, team: t.employees.team, department: t.employees.department }).from(t.employees).where(eq(t.employees.id, askerId!)).limit(1));
    const people = new Set<string>();
    if (!me?.managerId) return { rows: 0, people, note: "the asker has no manager in the company data" };
    const [mgr] = await q("ask.retrieve.manager", (db) => db.select({ ...empCols, managerId: t.employees.managerId }).from(t.employees).where(eq(t.employees.id, me.managerId!)).limit(1));
    if (mgr) {
      add(mgr, { kind: "manager", path: "manager", detail: `Manages the ${me.team} team, which you are on, and knows who owns what when nothing in the company data matches the ask.`, source: `employees.manager_id of ${askerId}`, recencyDays: null });
      people.add(mgr.id);
    }
    const [skip] = mgr?.managerId ? await q("ask.retrieve.skip_level", (db) => db.select(empCols).from(t.employees).where(eq(t.employees.id, mgr.managerId!)).limit(1)) : [];
    if (skip) {
      add(skip, { kind: "manager", path: "manager", detail: `Leads ${me.department}, your department, one level above your manager.`, source: `employees.manager_id of ${mgr!.id}`, recencyDays: null });
      people.add(skip.id);
    }
    log.branch(`${label} fall back to the asker's managers`, "no other path found anyone: ownership, history, skill, semantic and authorship all came back empty");
    return { rows: people.size, people };
  });

  // merge, cap
  const all: Candidate[] = [...pool.values()].map(({ emp, evidence }) => ({
    employeeId: emp.id,
    name: emp.name,
    title: emp.title,
    team: emp.team,
    sources: RETRIEVAL_PATHS.filter((p) => evidence.some((e) => e.path === p)),
    evidence,
  }));
  const strength = (c: Candidate) => c.sources.reduce((s, p) => s + CAP_WEIGHT[p], 0) + c.evidence.length * 0.1;
  const ordered = [...all].sort((a, b) => strength(b) - strength(a) || a.employeeId.localeCompare(b.employeeId));
  const kept = ordered.slice(0, MAX_CANDIDATES);
  const cut = ordered.slice(MAX_CANDIDATES).map((c) => c.employeeId);
  if (cut.length) log.branch(`${label} cap at ${MAX_CANDIDATES}, cut ${cut.length}`, `kept the people with the most and strongest evidence paths (cap order only, not the ranking); cut ${cut.join(", ")}`);
  else log.branch(`${label} keep all ${all.length} candidates`, `at or under the cap of ${MAX_CANDIDATES}`);
  const candidates = kept.sort((a, b) => a.name.localeCompare(b.name));
  const counts = Object.fromEntries(RETRIEVAL_PATHS.map((p) => [p, candidates.filter((c) => c.sources.includes(p)).length]));
  log.info(`${label} retrieval: ${candidates.length} candidates (${all.length} before the cap) by path ${RETRIEVAL_PATHS.map((p) => `${p}=${counts[p]}`).join(" ")}`, { counts });
  log.info(`${label} candidates: ${candidates.map((c) => `${c.employeeId} ${c.name} [${[...new Set(c.evidence.map((e) => e.kind))].join(",")}]`).join("; ") || "none"}`);
  for (const c of candidates) log.debug(`${label} candidate ${c.employeeId} ${c.name}: ${c.evidence.map((e) => `${e.kind}: ${e.detail}`).join(" | ")}`);

  return { candidates, summary: { version: 1, paths, total: candidates.length, beforeCap: all.length, cut, at: wallNow().toISOString() } };
}
