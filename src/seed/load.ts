import "server-only";
// Loads a Company into Postgres. Used by `pnpm seed`, `pnpm db:reset` and the /admin/seed
// reseed button. Runs in one transaction: either the whole new company is in place, or the
// old one is untouched.
//
// Accounts (users, usage_log) are never deleted by a reseed. Users keep their persona if the
// new company still has that employee id; otherwise the link is cleared and logged.

import { count, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, qIn, type Tx } from "@/db";
import * as t from "@/db/schema";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { loadsThisWeek } from "@/lib/availability";
import { clockLabel, demoInstant, wallNow } from "@/lib/clock";
import { addDays, localToUtc, todayIso } from "@/lib/time";
import { generateCalendars } from "./calendar";
import { addDemoPersona } from "./demo-persona";
import { generateDocHistory, PLANTED_DOC_FAILURES } from "./doc-history";
import { type Company, DEFAULT_SEED, readFixture } from "./fixture";
import { embedCompany, generateCompany, validateCompany } from "./generate";

const log = createLogger("seed");
const sumLog = createLogger("seed.summary");

/** Every table the seed replaces, children first (the delete order). */
const COMPANY_TABLES = [
  ["ramp_dismissals", t.rampDismissals],
  ["ramp_plans", t.rampPlans],
  ["ask_events", t.askEvents],
  ["ask_messages", t.askMessages],
  ["ask_doc_checks", t.askDocChecks],
  ["ask_candidates", t.askCandidates],
  ["asks", t.asks],
  ["calendar_events", t.calendarEvents],
  ["mentorships", t.mentorships],
  ["project_members", t.projectMembers],
  ["projects", t.projects],
  ["documents", t.documents],
  ["employee_skills", t.employeeSkills],
  ["services", t.services],
  ["skills", t.skills],
  ["employees", t.employees],
  ["orgs", t.orgs],
] as const;

export const COUNTED_TABLES = [...[...COMPANY_TABLES].reverse(), ["users", t.users], ["usage_log", t.usageLog]] as const;

export type SeedSummary = {
  seed: string;
  source: "fixture" | "generated";
  textSource: string;
  textModel: string | null;
  embeddingModel: string;
  anchorDay: string;
  loadedAt: string;
  totalMs: number;
  steps: { step: string; rows: number; ms: number }[];
  counts: Record<string, number>;
  usersRelinked: number;
  usersUnlinked: number;
  warnings: string[];
};

/** Fixture if its seed matches, else generate in memory with templated text. */
export async function resolveCompany(seed: string): Promise<{ company: Company; source: "fixture" | "generated"; warnings: string[] }> {
  const warnings: string[] = [];
  const fixture = await log.timed("read fixture", () => readFixture(), undefined, (f) => ({ found: !!f, fixtureSeed: f?.seed ?? null }));
  let company: Company;
  let source: "fixture" | "generated";
  if (fixture && fixture.seed === seed) {
    log.branch("use committed fixture", `fixtures/company.json was generated for seed "${seed}"`, { textSource: fixture.text.source, generatedAt: fixture.generatedAt });
    company = fixture;
    source = "fixture";
  } else {
    const reason = fixture ? `fixture is for seed "${fixture.seed}", not "${seed}"` : "fixtures/company.json does not exist";
    log.branch("generate company in memory with templated text", reason);
    const msg = `TEMPLATED TEXT: seed "${seed}" has no fixture, so bios, project text and document bodies are templates (no model call). Run pnpm fixture:generate ${seed} to commit one.`;
    log.warn(msg);
    warnings.push(msg);
    company = generateCompany(seed, log.child("generate"));
    embedCompany(company, log.child("embed"));
    source = "generated";
  }
  if (company.text.source === "template") {
    const msg = `text source is template (${company.text.note})`;
    if (source === "fixture") log.warn(`TEMPLATED TEXT: the committed fixture was generated without a model key; ${company.text.note}`);
    warnings.push(msg);
  }
  const problems = validateCompany(company);
  if (problems.length) {
    log.error(`company failed ${problems.length} structural checks`, { problems: problems.slice(0, 20) });
    throw new AppError("SEED_INVALID", `${problems.length} structural problems, first: ${problems[0]}`, { status: 500, context: { problems: problems.slice(0, 20) } });
  }
  log.info("company passed structural checks", { employees: company.employees.length, services: company.services.length, scenarios: company.scenarios.length });
  return { company, source, warnings };
}

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export async function seedDatabase(seed: string = DEFAULT_SEED): Promise<SeedSummary> {
  const t0 = performance.now();
  log.info(`seed start`, { seed });
  const { company: c, source, warnings } = await resolveCompany(seed);
  const anchor = todayIso(wallNow());
  const day = (offset: number) => addDays(anchor, offset);
  const tzOf = new Map(c.employees.map((e) => [e.id, e.timezone]));
  log.info(`dates are relative to load day ${anchor}`, { anchor, reason: "fixture stores day offsets so new hires stay new and next week stays next week" });
  // The guided demo's persona depends on the load day (eleven days in at the pinned clock).
  addDemoPersona(c, anchor, log);

  const calendar = await log.timed("generate calendars", async () => generateCalendars(c, anchor), { days: 14 }, (rows) => ({ events: rows.length }));

  const steps: SeedSummary["steps"] = [];
  const step = async (name: string, rows: number, fn: () => Promise<unknown>) => {
    const s0 = performance.now();
    await fn();
    const ms = Math.round(performance.now() - s0);
    steps.push({ step: name, rows, ms });
    log.info(`step ${name}: ${rows} rows in ${ms}ms`, { rows, ms });
  };
  const insertAll = async <R>(tx: Tx, name: string, table: Parameters<Tx["insert"]>[0], rows: R[], size = 500) => {
    await step(`insert ${name}`, rows.length, async () => {
      let i = 0;
      for (const part of chunks(rows, size)) {
        i++;
        await qIn(tx, `seed.insert.${name}.${i}`, (h) => h.insert(table).values(part as never));
      }
    });
  };

  let usersRelinked = 0;
  let usersUnlinked = 0;
  const docStats: { docFailures: string[]; docChecks: number } = { docFailures: [], docChecks: 0 };

  const db = getDb();
  await log.timed("transaction", () =>
    db.transaction(async (tx) => {
      const links = await qIn(tx, "seed.users.links", (h) => h.select({ id: t.users.id, employeeId: t.users.employeeId }).from(t.users).where(isNotNull(t.users.employeeId)));
      log.info(`remembered ${links.length} user persona links to restore after reseed`);

      await step("delete old company", COMPANY_TABLES.length, async () => {
        for (const [name, table] of COMPANY_TABLES) {
          const res = await qIn(tx, `seed.delete.${name}`, (h) => h.delete(table));
          log.debug(`deleted ${name}`, { rows: (res as { count?: number }).count ?? null });
        }
      });

      await insertAll(tx, "orgs", t.orgs, [{ ...c.org, seed: c.seed }]);
      await insertAll(
        tx,
        "employees",
        t.employees,
        c.employees.map((e) => ({
          id: e.id,
          orgId: c.org.id,
          name: e.name,
          title: e.title,
          department: e.department,
          team: e.team,
          seniority: e.seniority,
          timezone: e.timezone,
          startDate: day(e.startDay),
          managerId: e.managerId,
          slackHandle: e.slackHandle,
          email: e.email,
          bio: e.bio,
          isMentor: e.isMentor,
          maxWeeklyAsks: e.maxWeeklyAsks,
          embedding: e.embedding,
        })),
        100,
      );
      await insertAll(tx, "skills", t.skills, c.skills);
      await insertAll(tx, "employee_skills", t.employeeSkills, c.employeeSkills);
      await insertAll(
        tx,
        "services",
        t.services,
        c.services.map((s) => ({ ...s })),
        100,
      );
      await insertAll(
        tx,
        "projects",
        t.projects,
        c.projects.map((p) => ({ id: p.id, name: p.name, description: p.description, team: p.team, serviceId: p.serviceId, status: p.status, startedOn: day(p.startDay), endedOn: p.endDay === null ? null : day(p.endDay) })),
      );
      await insertAll(
        tx,
        "project_members",
        t.projectMembers,
        c.projects.flatMap((p) => p.members.map((m) => ({ projectId: p.id, employeeId: m.employeeId, role: m.role, startedOn: day(m.startDay), endedOn: m.endDay === null ? null : day(m.endDay) }))),
      );
      await insertAll(
        tx,
        "documents",
        t.documents,
        c.documents.map((d) => ({ id: d.id, title: d.title, kind: d.kind, authorId: d.authorId, serviceId: d.serviceId, body: d.body, updatedOn: day(d.updatedDay), embedding: d.embedding })),
        100,
      );
      await insertAll(
        tx,
        "mentorships",
        t.mentorships,
        c.mentorships.map((m) => ({ mentorId: m.mentorId, menteeId: m.menteeId, focus: m.focus, startedOn: day(m.startDay), endedOn: m.endDay === null ? null : day(m.endDay) })),
      );
      await insertAll(tx, "calendar_events", t.calendarEvents, calendar, 1000);

      const askRows = c.asks.map((a) => {
        const createdAt = localToUtc(day(a.createdDay), 9 * 60 + a.createdMinute, tzOf.get(a.askerEmployeeId) ?? "America/Los_Angeles");
        const resolvedAt = a.resolvedDay === null ? null : new Date(Math.max(createdAt.getTime() + 3600_000, localToUtc(day(a.resolvedDay), 16 * 60, tzOf.get(a.routedToId) ?? "America/Los_Angeles").getTime()));
        return { a, createdAt, resolvedAt };
      });
      await insertAll(
        tx,
        "asks",
        t.asks,
        askRows.map(({ a, createdAt, resolvedAt }) => ({
          id: a.id,
          userId: null,
          askerEmployeeId: a.askerEmployeeId,
          title: a.title,
          body: a.body,
          tried: a.tried,
          // The fixture predates the lifecycle (src/lib/ask-state.ts): "resolved" is now "answered".
          status: a.status === "resolved" ? ("answered" as const) : ("sent" as const),
          source: "seed" as const,
          routedToId: a.routedToId,
          createdAt,
          updatedAt: resolvedAt ?? createdAt,
          resolvedAt,
        })),
      );
      await insertAll(
        tx,
        "ask_candidates",
        t.askCandidates,
        askRows.map(({ a, createdAt }) => ({
          askId: a.id,
          employeeId: a.routedToId,
          rank: 1,
          score: 1,
          breakdown: { source: "seed", note: "seeded history: routed directly, no ranking was run", serviceId: a.serviceId },
          explanation: null,
          chosen: true,
          createdAt,
        })),
      );
      await insertAll(
        tx,
        "ask_events",
        t.askEvents,
        askRows.flatMap(({ a, createdAt, resolvedAt }) => [
          { askId: a.id, kind: "transition", fromState: null, toState: "sent" as const, actor: "system", reason: "seeded history: asked and routed directly, no ranking was run", data: { source: "seed" }, at: createdAt },
          { askId: a.id, kind: "marked_sent", data: { to: a.routedToId }, at: new Date(createdAt.getTime() + 10 * 60_000) },
          ...(resolvedAt
            ? [{ askId: a.id, kind: "transition", fromState: "sent" as const, toState: "answered" as const, actor: "system", reason: "seeded history: answered", data: null, at: resolvedAt }]
            : []),
        ]),
        1000,
      );

      // Docs offered for seeded asks that did not answer them (the /insights "documentation failed" panel).
      const createdOf = new Map(askRows.map(({ a, createdAt }) => [a.id, createdAt]));
      const docHistory = generateDocHistory(c).map((r) => {
        const at = createdOf.get(r.askId)!;
        return { ...r, createdAt: at, verdictAt: new Date(at.getTime() + 5 * 60_000) };
      });
      await insertAll(tx, "ask_doc_checks (seeded history)", t.askDocChecks, docHistory);
      docStats.docFailures = Object.keys(PLANTED_DOC_FAILURES).map((id) => `${id}:${docHistory.filter((r) => r.documentId === id).length}`);
      docStats.docChecks = docHistory.length;

      // Restore persona links that still point at a real employee.
      const ids = new Set(c.employees.map((e) => e.id));
      const keep = links.filter((l) => l.employeeId && ids.has(l.employeeId));
      usersUnlinked = links.length - keep.length;
      for (const l of keep) await qIn(tx, "seed.users.relink", (h) => h.update(t.users).set({ employeeId: l.employeeId }).where(eq(t.users.id, l.id)));
      usersRelinked = keep.length;
      if (usersUnlinked) log.warn(`${usersUnlinked} users lost their persona because the new company has no employee with that id`, { userIds: links.filter((l) => !keep.includes(l)).map((l) => l.id) });
      else log.debug("all user persona links restored", { relinked: usersRelinked });

      const meta: Record<string, string> = {
        "seed.string": c.seed,
        "seed.source": source,
        "seed.text_source": c.text.source,
        "seed.text_model": c.text.model ?? "",
        "seed.embedding_model": c.embedding.model,
        "seed.anchor_day": anchor,
        "seed.loaded_at": wallNow().toISOString(),
        "seed.fixture_generated_at": c.generatedAt,
        "seed.scenarios": JSON.stringify(c.scenarios),
        "seed.planted": JSON.stringify(c.employees.filter((e) => e.planted).map((e) => ({ id: e.id, planted: e.planted }))),
      };
      await step("write app_meta", Object.keys(meta).length, async () => {
        for (const [key, value] of Object.entries(meta)) {
          await qIn(tx, `seed.meta.${key}`, (h) =>
            h.insert(t.appMeta).values({ key, value }).onConflictDoUpdate({ target: t.appMeta.key, set: { value, updatedAt: sql`now()` } }),
          );
        }
        // The org-level insights opt-in is an admin decision: written once for the demo company,
        // never overwritten by a reseed (an admin who turned it off keeps it off).
        const optIn = JSON.stringify({ on: true, by: "seed", at: wallNow().toISOString(), why: "the synthetic demo company opts in so /insights has data" });
        const res = await qIn(tx, "seed.meta.insights.opt_in", (h) => h.insert(t.appMeta).values({ key: "insights.opt_in", value: optIn }).onConflictDoNothing().returning({ key: t.appMeta.key }));
        if (res.length) log.info("insights opt-in written for the demo company (on, by seed)");
        else log.skip("insights opt-in", "already set by an earlier seed or an admin; a reseed never changes it");
      });
    }),
  );

  const counts = await countRows();
  const summary: SeedSummary = {
    seed: c.seed,
    source,
    textSource: c.text.source,
    textModel: c.text.model,
    embeddingModel: c.embedding.model,
    anchorDay: anchor,
    loadedAt: wallNow().toISOString(),
    totalMs: Math.round(performance.now() - t0),
    steps,
    counts,
    usersRelinked,
    usersUnlinked,
    warnings,
  };
  await qIn(getDb(), "seed.meta.summary", (h) =>
    h
      .insert(t.appMeta)
      .values({ key: "seed.summary", value: JSON.stringify(summary) })
      .onConflictDoUpdate({ target: t.appMeta.key, set: { value: JSON.stringify(summary), updatedAt: sql`now()` } }),
  );
  await logSummary(summary, c);
  sumLog.info(`seeded doc history: ${docStats.docChecks} offered docs did not answer a seeded ask; planted failing docs ${docStats.docFailures.join(", ")}`);
  return summary;
}

export async function countRows(): Promise<Record<string, number>> {
  const db = getDb();
  const out: Record<string, number> = {};
  for (const [name, table] of COUNTED_TABLES) {
    const [row] = await qIn(db, `seed.count.${name}`, (h) => h.select({ n: count() }).from(table));
    out[name] = Number(row?.n ?? 0);
  }
  return out;
}

/**
 * The paste-me summary: one self-contained line per fact, all under scope [seed.summary],
 * so `grep seed.summary` gives the whole picture of what was loaded.
 */
async function logSummary(s: SeedSummary, c: Company): Promise<void> {
  sumLog.info(`seed "${s.seed}" loaded from ${s.source} in ${s.totalMs}ms`, {
    anchorDay: s.anchorDay,
    text: s.textSource,
    textModel: s.textModel,
    embedding: s.embeddingModel,
  });
  sumLog.info("row counts", s.counts);
  sumLog.info("step timings", Object.fromEntries(s.steps.map((x) => [x.step, `${x.rows} rows ${x.ms}ms`])));

  // Load as the demo sees it: the app's rule (loadsThisWeek) at the pinned demo clock.
  const demoNow = demoInstant(s.anchorDay);
  sumLog.info(`demo clock pinned at ${demoNow.toISOString()} (${clockLabel(demoNow)}); asks this week below are counted at that instant`);
  const loadOf = await loadsThisWeek(
    c.employees.map((e) => e.id),
    demoNow,
  );
  const byId = new Map(c.employees.map((e) => [e.id, e]));
  const ownerOf = (id: string) =>
    c.services.filter((x) => x.primaryOwnerId === id || x.secondaryOwnerId === id).map((x) => `${x.name}:${x.primaryOwnerId === id ? "primary" : "secondary"}`);

  for (const e of c.employees.filter((x) => x.planted)) {
    sumLog.info(`planted ${e.planted} ${e.id} ${e.name}`, {
      team: e.team,
      title: e.title,
      tz: e.timezone,
      asksLast7d: loadOf.get(e.id) ?? 0,
      maxWeeklyAsks: e.maxWeeklyAsks,
      owns: ownerOf(e.id),
      ooo: e.calendar.ooo ? `days ${e.calendar.ooo.from}..${e.calendar.ooo.to}` : undefined,
      fullyBookedDays: e.calendar.fullyBookedDays,
    });
  }
  for (const sc of c.scenarios) {
    const who = sc.expectId === "doc" ? `doc ${sc.docId}` : `${sc.expectId} ${byId.get(sc.expectId)?.name}`;
    sumLog.info(`scenario ${sc.id} (${sc.kind}) expects ${who}`, { traps: sc.trapIds, question: sc.question });
  }
  const over = [...loadOf.entries()].filter(([id, n]) => id && n > (byId.get(id)?.maxWeeklyAsks ?? 99)).map(([id, n]) => `${id}:${n}/${byId.get(id!)?.maxWeeklyAsks}`);
  sumLog.info(`${over.length} people are over their weekly ask limit`, { over });
  for (const w of s.warnings) sumLog.warn(w);
  if (s.usersUnlinked) sumLog.warn(`${s.usersUnlinked} users lost their persona link`);
}
