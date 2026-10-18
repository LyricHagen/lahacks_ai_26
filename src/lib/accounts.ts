import "server-only";
// Accounts: signup, password check, persona claim, and the admin decisions on top of them.
// Every decision logs one line that says what was decided and why.

import { wallNow } from "@/lib/clock";
import bcrypt from "bcryptjs";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, q, qIn, type Tx } from "@/db";
import * as t from "@/db/schema";
import { DEMO_EMAIL, DEMO_PERSONA_KEY } from "./demo-script";
import { AppError } from "./errors";
import { createLogger } from "./log";

const log = createLogger("auth.accounts");

const BCRYPT_ROUNDS = 12;
/** bcrypt only reads the first 72 bytes, so longer passwords are refused rather than silently cut. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;
/** Serializes signups so "first account becomes admin" and persona claims cannot race. */
const SIGNUP_LOCK_ID = 7_202_603;

// A real hash of a random string, made once per process, so an unknown email costs the same
// bcrypt time as a wrong password and response timing does not reveal which emails exist.
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  return (dummyHash ??= bcrypt.hash(crypto.randomUUID(), BCRYPT_ROUNDS));
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateSignupInput(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return "Enter a valid email address.";
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters for the password.`;
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) return `Use at most ${PASSWORD_MAX_BYTES} bytes for the password.`;
  return null;
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// persona claim
// ---------------------------------------------------------------------------

export type ClaimedPersona = { id: string; name: string; title: string; team: string; managerId: string | null };

/**
 * Pick an unclaimed colleague for a new account to play. Prefers the planted new hire persona
 * (newhire_*), then the most recently started junior or mid employee with a manager. Never picks
 * the demo persona (reserved for the demo account) or another planted role (overloaded, decoy, vacation, booked): those are the scenario answers and
 * traps. Must run inside the signup lock.
 */
async function claimPersona(tx: Tx): Promise<{ persona: ClaimedPersona | null; tier: string }> {
  const meta = await qIn(tx, "auth.persona.planted", (h) => h.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, "seed.planted")));
  let planted: Array<{ id: string; planted: string }> = [];
  try {
    planted = meta[0] ? (JSON.parse(meta[0].value) as typeof planted) : [];
  } catch (err) {
    log.error("seed.planted in app_meta is not valid JSON, treating every employee as unplanted", { err });
  }
  // The demo persona (newhire_backend) is reserved for the shared demo account.
  const claimable = (p: { planted: string }) => p.planted.startsWith("newhire") && p.planted !== DEMO_PERSONA_KEY;
  const newhire = planted.filter(claimable).map((p) => p.id);
  const excluded = planted.filter((p) => !claimable(p)).map((p) => p.id);
  const excludedSql = excluded.length ? sql`and e.id not in (${sql.join(excluded.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const newhireSql = newhire.length ? sql`(e.id in (${sql.join(newhire.map((id) => sql`${id}`), sql`, `)}))` : sql`false`;

  const tiers: Array<{ name: string; where: ReturnType<typeof sql> }> = [
    { name: "new hire or junior/mid with a manager", where: sql`e.manager_id is not null and e.seniority in ('junior', 'mid')` },
    { name: "anyone with a manager", where: sql`e.manager_id is not null` },
  ];
  for (const tier of tiers) {
    const rows = await qIn(tx, "auth.persona.pick", (h) =>
      h.execute<{ id: string; name: string; title: string; team: string; manager_id: string | null }>(sql`
        select e.id, e.name, e.title, e.team, e.manager_id
        from employees e
        where ${tier.where} ${excludedSql}
          and not exists (select 1 from users u where u.employee_id = e.id)
        order by ${newhireSql} desc, e.start_date desc, e.id
        limit 1`),
    );
    const r = rows[0];
    if (r) return { persona: { id: r.id, name: r.name, title: r.title, team: r.team, managerId: r.manager_id }, tier: tier.name };
    log.branch(`try next persona tier after "${tier.name}"`, "no unclaimed employee in this tier");
  }
  return { persona: null, tier: "none" };
}

// ---------------------------------------------------------------------------
// signup and login
// ---------------------------------------------------------------------------

export type CreatedAccount = {
  id: string;
  email: string;
  role: "user" | "admin";
  status: "pending" | "approved" | "rejected";
  adminReason: string | null;
  persona: ClaimedPersona | null;
};

export async function createAccount(rawEmail: string, password: string): Promise<CreatedAccount> {
  const email = normalizeEmail(rawEmail);
  const problem = validateSignupInput(email, password);
  if (problem) {
    log.info(`signup refused: invalid input (${problem})`);
    throw new AppError("AUTH_INVALID_INPUT", problem, { status: 400 });
  }
  const passwordHash = await log.timed("hash password", () => bcrypt.hash(password, BCRYPT_ROUNDS), { rounds: BCRYPT_ROUNDS });

  const created = await getDb().transaction(async (tx) => {
    await qIn(tx, "auth.signup.lock", (h) => h.execute(sql`select pg_advisory_xact_lock(${SIGNUP_LOCK_ID})`));
    const existing = await qIn(tx, "auth.signup.exists", (h) => h.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, email)).limit(1));
    if (existing[0]) {
      log.info(`signup refused: email already has account ${existing[0].id}`, { userId: existing[0].id });
      throw new AppError("AUTH_EMAIL_TAKEN", undefined, { status: 409 });
    }
    const [{ n }] = await qIn(tx, "auth.signup.count", (h) => h.select({ n: sql<number>`count(*)::int` }).from(t.users));
    const isFirst = n === 0;
    const listed = adminEmails().includes(email);
    const adminReason = isFirst ? "first_account" : listed ? "admin_emails" : null;
    if (isFirst) log.branch("make this account admin and approved", "it is the first account ever created");
    else if (listed) log.branch("make this account admin and approved", "its email is in ADMIN_EMAILS");
    else log.branch("create as role user, status pending", `not the first account (${n} exist) and not in ADMIN_EMAILS`);

    const { persona, tier } = await claimPersona(tx);
    if (persona) log.info(`persona ${persona.id} (${persona.name}, ${persona.team}) claimed`, { tier, managerId: persona.managerId });
    else log.warn("no unclaimed persona left in the synthetic company, account created without one", { existingUsers: n });

    const now = wallNow();
    const [row] = await qIn(tx, "auth.signup.insert", (h) =>
      h
        .insert(t.users)
        .values({
          email,
          passwordHash,
          role: adminReason ? "admin" : "user",
          status: adminReason ? "approved" : "pending",
          adminReason,
          employeeId: persona?.id ?? null,
          approvedAt: adminReason ? now : null,
        })
        .returning({ id: t.users.id, email: t.users.email, role: t.users.role, status: t.users.status, adminReason: t.users.adminReason }),
    );
    return { ...row, persona };
  });

  if (created.adminReason === "first_account") {
    log.warn(`FIRST ACCOUNT: ${created.id} <${created.email}> is now ADMIN and APPROVED automatically. Every later signup starts pending.`, { userId: created.id });
  } else if (created.adminReason === "admin_emails") {
    log.warn(`ADMIN_EMAILS: ${created.id} <${created.email}> promoted to ADMIN and APPROVED on signup.`, { userId: created.id });
  }
  log.info(`signup: created ${created.id} role=${created.role} status=${created.status} persona=${created.persona?.id ?? "none"}`, { userId: created.id });
  return created;
}

/**
 * Check an email and password. Returns the account or null. Unknown email and wrong password
 * look identical to the caller (and take the same time); only the log says which.
 */
export async function verifyCredentials(rawEmail: string, password: string): Promise<{ id: string; email: string } | null> {
  const email = normalizeEmail(rawEmail);
  if (!email || !password) {
    log.info("login check: rejected (empty email or password)");
    return null;
  }
  const rows = await q("auth.login.lookup", (db) => db.select({ id: t.users.id, email: t.users.email, passwordHash: t.users.passwordHash, status: t.users.status }).from(t.users).where(eq(t.users.email, email)).limit(1));
  const row = rows[0];
  const ok = await bcrypt.compare(password, row?.passwordHash ?? (await getDummyHash()));
  if (!row) {
    log.info("login check: rejected (no account with that email; caller sees the same generic message)");
    return null;
  }
  if (!ok) {
    log.info(`login check: rejected for ${row.id} (password mismatch; caller sees the same generic message)`, { userId: row.id });
    return null;
  }
  // Rejected accounts may still sign in: they see a plain "not approved" message on /pending.
  await q("auth.login.touch", (db) => db.update(t.users).set({ lastLoginAt: wallNow() }).where(eq(t.users.id, row.id)));
  log.info(`login check: accepted ${row.id} (status ${row.status})`, { userId: row.id });
  return { id: row.id, email: row.email };
}

// ---------------------------------------------------------------------------
// the shared demo account
// ---------------------------------------------------------------------------

/** The guided demo's account, for the "demo" sign-in provider (src/lib/auth-config.ts). */
export async function findDemoAccount(): Promise<{ id: string; email: string } | null> {
  const rows = await q("auth.demo.find", (db) => db.select({ id: t.users.id, email: t.users.email }).from(t.users).where(eq(t.users.isDemo, true)).limit(1));
  return rows[0] ?? null;
}

/**
 * Create the shared demo account if it is missing, and point it at the demo persona. Its password
 * is a hash of a random string nobody knows, so it can only be entered through the demo action.
 * If another account somehow plays the persona, that account loses it (logged): the guided demo
 * needs it.
 */
export async function ensureDemoAccount(personaId: string): Promise<{ id: string; created: boolean; relinked: boolean }> {
  return getDb().transaction(async (tx) => {
    await qIn(tx, "auth.demo.lock", (h) => h.execute(sql`select pg_advisory_xact_lock(${SIGNUP_LOCK_ID})`));
    const [existing] = await qIn(tx, "auth.demo.lookup", (h) =>
      h.select({ id: t.users.id, employeeId: t.users.employeeId, isDemo: t.users.isDemo }).from(t.users).where(sql`${t.users.isDemo} or ${t.users.email} = ${DEMO_EMAIL}`).limit(1),
    );
    const holder = await qIn(tx, "auth.demo.persona_holder", (h) => h.select({ id: t.users.id }).from(t.users).where(and(eq(t.users.employeeId, personaId), sql`not ${t.users.isDemo}`)));
    for (const u of holder) {
      log.warn(`demo persona ${personaId} was played by ${u.id}; unlinked so the demo account can play it (the persona is reserved for the guided demo)`, { userId: u.id });
      await qIn(tx, "auth.demo.unlink", (h) => h.update(t.users).set({ employeeId: null }).where(eq(t.users.id, u.id)));
    }
    if (existing) {
      const relinked = existing.employeeId !== personaId || !existing.isDemo;
      if (relinked) {
        await qIn(tx, "auth.demo.relink", (h) => h.update(t.users).set({ employeeId: personaId, isDemo: true, status: "approved", role: "user" }).where(eq(t.users.id, existing.id)));
        log.info(`demo account ${existing.id} now plays ${personaId} (was ${existing.employeeId ?? "none"})`, { userId: existing.id });
      }
      return { id: existing.id, created: false, relinked };
    }
    const passwordHash = await bcrypt.hash(crypto.randomUUID(), BCRYPT_ROUNDS);
    const [row] = await qIn(tx, "auth.demo.insert", (h) =>
      h
        .insert(t.users)
        // Approved so no "pending" screens show; is_demo keeps it in demo mode (resolveMode, gate 2).
        .values({ email: DEMO_EMAIL, passwordHash, role: "user", status: "approved", isDemo: true, employeeId: personaId, approvedAt: wallNow() })
        .returning({ id: t.users.id }),
    );
    log.warn(`DEMO ACCOUNT: created ${row.id} <${DEMO_EMAIL}> playing ${personaId}; shared by everyone who enters the guided demo, always in demo mode`, { userId: row.id });
    return { id: row.id, created: true, relinked: false };
  });
}

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

export type AdminUserRow = {
  id: string;
  email: string;
  role: "user" | "admin";
  status: "pending" | "approved" | "rejected";
  adminReason: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  isDemo: boolean;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  employeeId: string | null;
  personaName: string | null;
  personaTeam: string | null;
  tokens: number;
  costUsd: number;
  calls: number;
};

export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  const rows = await q("admin.users.list", (db) =>
    db
      .select({
        id: t.users.id,
        email: t.users.email,
        role: t.users.role,
        status: t.users.status,
        adminReason: t.users.adminReason,
        createdAt: t.users.createdAt,
        lastLoginAt: t.users.lastLoginAt,
        approvedAt: t.users.approvedAt,
        approvedBy: t.users.approvedBy,
        isDemo: t.users.isDemo,
        rejectedAt: t.users.rejectedAt,
        rejectedBy: t.users.rejectedBy,
        employeeId: t.users.employeeId,
        personaName: t.employees.name,
        personaTeam: t.employees.team,
        tokens: sql<number>`coalesce((select sum(u.input_tokens + u.output_tokens) from usage_log u where u.user_id = ${t.users.id}), 0)::int`,
        costUsd: sql<number>`coalesce((select sum(u.cost_usd) from usage_log u where u.user_id = ${t.users.id}), 0)::float8`,
        calls: sql<number>`(select count(*) from usage_log u where u.user_id = ${t.users.id})::int`,
      })
      .from(t.users)
      .leftJoin(t.employees, eq(t.employees.id, t.users.employeeId))
      .orderBy(sql`case ${t.users.status} when 'pending' then 0 when 'approved' then 1 else 2 end`, desc(t.users.createdAt)),
  );
  log.debug(`admin user list: ${rows.length} accounts`, { pending: rows.filter((r) => r.status === "pending").length });
  return rows;
}

/** Approve or reject an account. Logs who decided, about whom, and when. */
export async function setUserStatus(admin: { id: string; email: string }, targetId: string, status: "approved" | "rejected"): Promise<{ id: string; email: string; status: string; at: string }> {
  const target = await q("admin.users.target", (db) => db.select({ id: t.users.id, email: t.users.email, status: t.users.status, role: t.users.role, isDemo: t.users.isDemo }).from(t.users).where(eq(t.users.id, targetId)).limit(1));
  const row = target[0];
  if (!row) {
    log.warn(`admin decision refused: ${targetId} does not exist`, { targetId, adminId: admin.id });
    throw new AppError("USER_NOT_FOUND", undefined, { status: 404 });
  }
  if (row.isDemo) {
    log.warn(`admin decision refused: ${row.id} is the shared demo account, which is always in demo mode`, { targetId: row.id, adminId: admin.id });
    throw new AppError("BAD_REQUEST", "The demo account cannot be approved or rejected. It is always in demo mode.", { status: 400 });
  }
  if (row.id === admin.id && status === "rejected") {
    log.warn(`admin decision refused: ${admin.id} tried to reject their own account`, { adminId: admin.id });
    throw new AppError("BAD_REQUEST", "You cannot reject your own account.", { status: 400 });
  }
  if (row.status === status) {
    log.skip(`set ${row.id} to ${status}`, `it is already ${status}`, { targetId: row.id });
    return { id: row.id, email: row.email, status, at: wallNow().toISOString() };
  }
  const now = wallNow();
  await q("admin.users.set_status", (db) =>
    db
      .update(t.users)
      .set(
        status === "approved"
          ? { status, approvedAt: now, approvedBy: admin.id, rejectedAt: null, rejectedBy: null }
          : { status, rejectedAt: now, rejectedBy: admin.id, approvedAt: null, approvedBy: null },
      )
      .where(and(eq(t.users.id, row.id))),
  );
  log.info(`admin decision: ${admin.id} <${admin.email}> ${status === "approved" ? "APPROVED" : "REJECTED"} ${row.id} <${row.email}> at ${now.toISOString()} (was ${row.status})`, {
    adminId: admin.id,
    targetId: row.id,
    from: row.status,
    to: status,
  });
  return { id: row.id, email: row.email, status, at: now.toISOString() };
}

export type PersonaSummary = { id: string; name: string; title: string; team: string; managerId: string | null; managerName: string | null };

/** The colleague an account plays, with their manager, for /pending and /account. */
export async function getPersonaSummary(employeeId: string | null): Promise<PersonaSummary | null> {
  if (!employeeId) {
    log.skip("persona lookup", "account has no persona");
    return null;
  }
  const rows = await q("auth.persona.summary", (db) =>
    db.execute<{ id: string; name: string; title: string; team: string; manager_id: string | null; manager_name: string | null }>(sql`
      select e.id, e.name, e.title, e.team, e.manager_id, m.name as manager_name
      from employees e left join employees m on m.id = e.manager_id
      where e.id = ${employeeId}`),
  );
  const r = rows[0];
  if (!r) {
    log.warn(`persona ${employeeId} not found in the loaded company`, { employeeId });
    return null;
  }
  return { id: r.id, name: r.name, title: r.title, team: r.team, managerId: r.manager_id, managerName: r.manager_name };
}
