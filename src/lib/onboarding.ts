import "server-only";
// Onboarding: three short steps (role, context, channels), each saved on its own so back and
// refresh work. Skipping a step fills its defaults; skipping the rest fills every missing step.
// Ranking (prompt 6), drafting (7) and the ramp plan (9) read the profile through getProfile.

import { wallNow } from "@/lib/clock";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import type { SessionUser } from "./auth";
import { DEMO_PERSONA_KEY } from "./demo-script";
import { AppError } from "./errors";
import { createLogger } from "./log";

const log = createLogger("onboarding");

export const ONBOARDING_STEPS = ["role", "context", "channels"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const STEP_LABEL: Record<OnboardingStep, string> = { role: "Your role", context: "What you know", channels: "How you reach people" };

export const CHANNELS = ["slack", "email", "call"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = { slack: "Slack DM", email: "Email", call: "A scheduled call" };

export const FOCUS_MAX = 500;
/** Skills at or above this proficiency count as already known when the user skips the context step. */
const KNOWN_PROFICIENCY = 2;
/** Same lock as signup, so a persona switch and a signup can never claim the same colleague. */
const PERSONA_LOCK_ID = 7_202_603;

export type Profile = typeof t.userProfiles.$inferSelect;

export async function getProfile(userId: string): Promise<Profile | null> {
  const rows = await q("onboarding.profile", (db) => db.select().from(t.userProfiles).where(eq(t.userProfiles.userId, userId)).limit(1));
  return rows[0] ?? null;
}

export function stepDone(p: Profile | null, step: OnboardingStep): boolean {
  if (!p) return false;
  return step === "role" ? !!p.roleConfirmedAt : step === "context" ? !!p.contextAt : !!p.channelsAt;
}

/** The first step not done yet, or null when onboarding is complete (or was skipped). */
export function nextStep(p: Profile | null): OnboardingStep | null {
  if (p?.completedAt) return null;
  return ONBOARDING_STEPS.find((s) => !stepDone(p, s)) ?? null;
}

export async function needsOnboarding(userId: string): Promise<boolean> {
  const p = await getProfile(userId);
  const next = nextStep(p);
  log.debug(`onboarding for ${userId}: ${next ? `next step ${next}` : "complete"}`, { userId, completedAt: p?.completedAt ?? null, usedDefaults: p?.usedDefaults ?? null });
  return next !== null;
}

// ---------------------------------------------------------------------------
// defaults
// ---------------------------------------------------------------------------

export type ContextDefaults = { knownSkillIds: string[]; firstFocus: string; why: string };

/** What we assume when the user skips the context step: their persona's own skills and current project. */
export async function contextDefaults(employeeId: string | null): Promise<ContextDefaults> {
  if (!employeeId) {
    log.branch("empty context defaults", "account has no persona");
    return { knownSkillIds: [], firstFocus: "", why: "no persona" };
  }
  const [skills, projects, emp] = await Promise.all([
    q("onboarding.defaults.skills", (db) =>
      db
        .select({ id: t.employeeSkills.skillId })
        .from(t.employeeSkills)
        .where(and(eq(t.employeeSkills.employeeId, employeeId), sql`${t.employeeSkills.proficiency} >= ${KNOWN_PROFICIENCY}`)),
    ),
    q("onboarding.defaults.project", (db) =>
      db
        .select({ name: t.projects.name, description: t.projects.description })
        .from(t.projectMembers)
        .innerJoin(t.projects, eq(t.projects.id, t.projectMembers.projectId))
        .where(and(eq(t.projectMembers.employeeId, employeeId), eq(t.projects.status, "active")))
        .orderBy(asc(t.projects.startedOn))
        .limit(1),
    ),
    q("onboarding.defaults.team", (db) => db.select({ team: t.employees.team }).from(t.employees).where(eq(t.employees.id, employeeId)).limit(1)),
  ]);
  const p = projects[0];
  const firstFocus = p ? `${p.name}: ${p.description}` : `Getting set up on the ${emp[0]?.team ?? "new"} team.`;
  const why = `${skills.length} persona skills at proficiency ${KNOWN_PROFICIENCY}+, focus from ${p ? "active project" : "team name"}`;
  return { knownSkillIds: skills.map((s) => s.id), firstFocus, why };
}

// ---------------------------------------------------------------------------
// personas
// ---------------------------------------------------------------------------

export type PersonaOption = { id: string; name: string; title: string; team: string; department: string; startDate: string; managerName: string | null; current: boolean };

/**
 * Colleagues an account may play: junior or mid with a manager (or the planted new hire), not
 * planted as a scenario answer or trap, and not played by another account.
 */
export async function listPersonaOptions(user: SessionUser): Promise<PersonaOption[]> {
  const rows = await q("onboarding.personas", (db) =>
    db.execute<{ id: string; name: string; title: string; team: string; department: string; start_date: string; manager_name: string | null }>(sql`
      select e.id, e.name, e.title, e.team, e.department, e.start_date::text as start_date, m.name as manager_name
      from employees e
      left join employees m on m.id = e.manager_id
      ${claimableWhere(user.id)}
      order by e.department, e.team, e.start_date desc, e.name`),
  );
  log.debug(`${rows.length} personas available to ${user.id}`, { userId: user.id });
  return rows.map((r) => ({ id: r.id, name: r.name, title: r.title, team: r.team, department: r.department, startDate: r.start_date, managerName: r.manager_name, current: r.id === user.employeeId }));
}

function claimableWhere(userId: string) {
  return sql`
    where (
      (e.manager_id is not null and e.seniority in ('junior', 'mid'))
      or e.id in (select x->>'id' from app_meta, jsonb_array_elements(value::jsonb) x where key = 'seed.planted' and x->>'planted' like 'newhire%' and x->>'planted' <> ${DEMO_PERSONA_KEY})
    )
    and e.id not in (select x->>'id' from app_meta, jsonb_array_elements(value::jsonb) x where key = 'seed.planted' and (x->>'planted' not like 'newhire%' or x->>'planted' = ${DEMO_PERSONA_KEY}))
    and not exists (select 1 from users u where u.employee_id = e.id and u.id <> ${userId})`;
}

export async function switchPersona(user: SessionUser, employeeId: string): Promise<{ from: string | null; to: string; name: string }> {
  if (employeeId === user.employeeId) {
    log.skip(`persona switch for ${user.id}`, `${employeeId} is already their persona`);
    return { from: user.employeeId, to: employeeId, name: "" };
  }
  const result = await getDb().transaction(async (tx) => {
    await qIn(tx, "onboarding.persona.lock", (h) => h.execute(sql`select pg_advisory_xact_lock(${PERSONA_LOCK_ID})`));
    const ok = await qIn(tx, "onboarding.persona.check", (h) =>
      h.execute<{ id: string; name: string }>(sql`select e.id, e.name from employees e ${claimableWhere(user.id)} and e.id = ${employeeId}`),
    );
    if (!ok[0]) {
      log.warn(`persona switch refused for ${user.id}: ${employeeId} is not claimable (claimed by another account, planted, senior, or missing)`, { userId: user.id, employeeId });
      throw new AppError("PERSONA_UNAVAILABLE", undefined, { status: 409 });
    }
    await qIn(tx, "onboarding.persona.set", (h) => h.update(t.users).set({ employeeId }).where(eq(t.users.id, user.id)));
    // A new persona means new defaults: forget context answers that were only defaults.
    await qIn(tx, "onboarding.persona.reset_context", (h) =>
      h.update(t.userProfiles).set({ contextAt: null, updatedAt: wallNow() }).where(and(eq(t.userProfiles.userId, user.id), eq(t.userProfiles.usedDefaults, true))),
    );
    return { from: user.employeeId, to: employeeId, name: ok[0].name };
  });
  log.info(`persona switch: ${user.id} now plays ${result.to} (${result.name}), was ${result.from ?? "none"}`, { userId: user.id, from: result.from, to: result.to });
  return result;
}

// ---------------------------------------------------------------------------
// saving steps
// ---------------------------------------------------------------------------

async function upsert(userId: string, values: Partial<typeof t.userProfiles.$inferInsert>, label: string) {
  const now = wallNow();
  await q(`onboarding.save.${label}`, (db) =>
    db
      .insert(t.userProfiles)
      .values({ userId, ...values, updatedAt: now })
      .onConflictDoUpdate({ target: t.userProfiles.userId, set: { ...values, updatedAt: now } }),
  );
}

export async function confirmRole(user: SessionUser): Promise<void> {
  await upsert(user.id, { roleConfirmedAt: wallNow() }, "role");
  log.info(`onboarding step role saved for ${user.id}: persona ${user.employeeId ?? "none"} confirmed`, { userId: user.id });
}

export async function saveContext(user: SessionUser, input: { knownSkillIds: string[]; firstFocus: string }): Promise<{ knownSkills: number }> {
  const ids = [...new Set((input.knownSkillIds ?? []).filter((x) => typeof x === "string"))];
  const focus = (input.firstFocus ?? "").trim();
  if (focus.length > FOCUS_MAX || ids.length > 100) {
    log.info(`onboarding context refused for ${user.id}: focus ${focus.length} chars, ${ids.length} skills`);
    throw new AppError("ONBOARDING_INVALID", `Keep "working on first" under ${FOCUS_MAX} characters.`, { status: 400 });
  }
  const valid = ids.length ? await q("onboarding.skills.valid", (db) => db.select({ id: t.skills.id }).from(t.skills).where(inArray(t.skills.id, ids))) : [];
  if (valid.length !== ids.length) {
    const known = new Set(valid.map((v) => v.id));
    log.warn(`onboarding context: dropping unknown skill ids for ${user.id}`, { unknown: ids.filter((i) => !known.has(i)) });
  }
  await upsert(user.id, { knownSkillIds: valid.map((v) => v.id), firstFocus: focus, contextAt: wallNow() }, "context");
  log.info(`onboarding step context saved for ${user.id}: ${valid.length} known skills, focus ${focus.length} chars`, { userId: user.id });
  return { knownSkills: valid.length };
}

export async function saveChannels(user: SessionUser, input: { preferredChannel: string; okToInterruptSeniors: boolean }): Promise<void> {
  if (!(CHANNELS as readonly string[]).includes(input.preferredChannel)) {
    log.info(`onboarding channels refused for ${user.id}: unknown channel ${input.preferredChannel}`);
    throw new AppError("ONBOARDING_INVALID", "Pick Slack DM, email or a scheduled call.", { status: 400 });
  }
  const now = wallNow();
  await upsert(user.id, { preferredChannel: input.preferredChannel as Channel, okToInterruptSeniors: !!input.okToInterruptSeniors, channelsAt: now, completedAt: now }, "channels");
  log.info(`onboarding step channels saved for ${user.id}: ${input.preferredChannel}, interrupt seniors ${input.okToInterruptSeniors ? "yes" : "no"}; onboarding complete`, { userId: user.id });
}

/** Fill defaults for one step, or (step "rest") for every step not done yet, and mark complete. */
export async function skipOnboarding(user: SessionUser, step: OnboardingStep | "rest"): Promise<{ next: OnboardingStep | null }> {
  const p = await getProfile(user.id);
  const now = wallNow();
  const todo = step === "rest" ? ONBOARDING_STEPS.filter((s) => !stepDone(p, s)) : [step];
  const values: Partial<typeof t.userProfiles.$inferInsert> = { usedDefaults: true };
  for (const s of todo) {
    if (s === "role") values.roleConfirmedAt = now;
    if (s === "context") {
      const d = await contextDefaults(user.employeeId);
      Object.assign(values, { knownSkillIds: d.knownSkillIds, firstFocus: d.firstFocus, contextAt: now });
      log.branch(`context defaults for ${user.id}`, d.why);
    }
    if (s === "channels") Object.assign(values, { preferredChannel: "slack", okToInterruptSeniors: false, channelsAt: now });
  }
  if (step === "rest" || step === "channels") values.completedAt = now;
  await upsert(user.id, values, "skip");
  const next = step === "rest" ? null : nextStep({ ...(p ?? emptyProfile(user.id)), ...values } as Profile);
  log.info(`onboarding skip ${step} for ${user.id}: defaults used for ${todo.join(", ") || "nothing"}; next ${next ?? "done"}`, { userId: user.id });
  return { next };
}

function emptyProfile(userId: string): Profile {
  return {
    userId,
    knownSkillIds: [],
    firstFocus: "",
    preferredChannel: "slack",
    okToInterruptSeniors: false,
    roleConfirmedAt: null,
    contextAt: null,
    channelsAt: null,
    completedAt: null,
    usedDefaults: false,
    updatedAt: wallNow(),
  };
}

export async function listSkillsByCategory() {
  const rows = await q("onboarding.skills", (db) => db.select({ id: t.skills.id, name: t.skills.name, category: t.skills.category }).from(t.skills).orderBy(asc(t.skills.category), asc(t.skills.name)));
  const groups = new Map<string, Array<{ id: string; name: string }>>();
  for (const r of rows) groups.set(r.category, [...(groups.get(r.category) ?? []), { id: r.id, name: r.name }]);
  return [...groups.entries()].map(([category, skills]) => ({ category, skills }));
}
