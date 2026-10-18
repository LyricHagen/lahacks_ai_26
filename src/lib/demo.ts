import "server-only";
// The guided demo's state: the shared demo account, its ask history and the guided ask, and the
// one-click reset that puts all of it back. Steps and texts are in src/lib/demo-script.ts.
//
// Reset demo (resetDemo):
//   1. deletes every demo ask (asks.source = 'demo': the demo account's and signed-out visitors'),
//      with their events, candidates, doc checks and drafts, plus demo ramp plans and dismissals,
//      and the per-address new-ask rate limit windows (judges on one network share an address).
//      Load is counted from `sent` events, so this alone puts every load counter back to the seed.
//   2. re-links the demo account to the demo persona and resets its onboarding profile.
//   3. rebuilds the ask history (DEMO_HISTORY) and the guided ask (GUIDED_ASK) through the real
//      pipeline, at the pinned demo clock, in demo mode (recorded fixtures, else deterministic).
//   4. logs exactly what it removed, what it made, and every load counter that moved.
// grep "demo reset" for all of it. Accounts' own asks are never touched.
//
// The whole build runs as the demo account (sessionUser, mode and clock preset in the request
// memo), whoever pressed the button, so an admin pressing it never spends a live call. Only the
// owner's record script (pnpm fixtures:record) runs it live, through runAsScript.

import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import { chooseCandidate } from "./ask-actions";
import { confirmAsk } from "./ask-confirm";
import { markAnswered, markSent } from "./ask-outcome";
import { runAskPipeline } from "./ask-pipeline";
import { asDraftSummary } from "./ask-draft-step";
import { asRanking } from "./ask-review";
import type { AskState } from "./ask-state";
import { insertAndSubmitAsk } from "./asks";
import { ensureDemoAccount } from "./accounts";
import { type SessionUser, SESSION_MEMO_KEY } from "./auth";
import { loadsThisWeek } from "./availability";
import { type AppClock, clockLabel, wallMs, wallNow } from "./clock";
import { CLOCK_MEMO_KEY } from "./clock-request";
import { demoClock } from "./clock-server";
import { DEMO_HISTORY, DEMO_PERSONA_KEY, type DemoAskDef, GUIDED_ASK } from "./demo-script";
import { AppError, toAppError } from "./errors";
import { createLogger, currentRequest, requestStorage } from "./log";
import { shortId } from "./log-format";
import { type ResolvedMode, resolveMode } from "./mode";
import { MODE_MEMO_KEY } from "./mode-request";
import { contextDefaults } from "./onboarding";
import { getRampView } from "./ramp";
import { normalizeUnderstanding } from "./understanding";
import type { Viewer } from "./viewer";

const log = createLogger("demo");

const STATE_KEY = "demo.state";
const LOCK_KEY = "demo.lock";
/** A reset normally takes a few seconds; a crashed one frees the lock after this. */
const LOCK_S = 60;
const DAY_MS = 86_400_000;

export const DEMO_FOCUS = "Getting billing-service deploys to staging working for the carrier payouts work.";

export type DemoAskRef = { key: string; askId: string; state: AskState; recipientId: string | null };

export type DemoState = {
  version: 1;
  accountId: string;
  personaId: string;
  guidedAskId: string;
  history: DemoAskRef[];
  resetAt: string;
  resetBy: string;
  ms: number;
  clock: string;
};

export type DemoResetReport = {
  ms: number;
  by: string;
  deleted: { asks: number; byState: Record<string, number>; events: number; candidates: number; docChecks: number; messages: number; rampPlans: number; rampDismissals: number; askLimits: number; accountAsks: number; visitorAsks: number };
  loads: Array<{ id: string; name: string; before: number; after: number }>;
  created: DemoAskRef[];
  guidedAskId: string;
  clock: string;
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

export async function demoPersonaId(): Promise<string | null> {
  const [row] = await q("demo.planted", (db) => db.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, "seed.planted")).limit(1));
  try {
    const planted = row ? (JSON.parse(row.value) as Array<{ id: string; planted: string }>) : [];
    return planted.find((p) => p.planted === DEMO_PERSONA_KEY)?.id ?? null;
  } catch (err) {
    log.error("seed.planted in app_meta is not valid JSON", { err });
    return null;
  }
}

export async function readDemoState(): Promise<DemoState | null> {
  const [row] = await q("demo.state.read", (db) => db.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, STATE_KEY)).limit(1));
  if (!row) return null;
  try {
    const s = JSON.parse(row.value) as DemoState;
    return s.version === 1 && s.guidedAskId ? s : null;
  } catch (err) {
    log.error("demo.state in app_meta is not valid JSON, treating the demo as not prepared", { err });
    return null;
  }
}

/** The state, prepared first if it is missing or its guided ask is gone (after a reseed). */
export async function ensureDemoState(why: string): Promise<DemoState> {
  const s = await readDemoState();
  if (s) {
    const [ask] = await q("demo.state.guided", (db) => db.select({ id: t.asks.id, userId: t.asks.userId }).from(t.asks).where(eq(t.asks.id, s.guidedAskId)).limit(1));
    if (ask && ask.userId === s.accountId) {
      log.debug(`demo state ok: guided ${s.guidedAskId}, reset ${s.resetAt} by ${s.resetBy}`);
      return s;
    }
    log.branch("prepare the demo again", `${why}: guided ask ${s.guidedAskId} no longer exists (reseeded?)`);
  } else {
    log.branch("prepare the demo", `${why}: no demo state yet`);
  }
  await resetDemo(`auto (${why})`);
  const fresh = await readDemoState();
  if (!fresh) throw new AppError("DEMO_RESET_FAILED", "The demo was prepared but its state was not saved.");
  return fresh;
}

// ---------------------------------------------------------------------------
// acting as the demo account
// ---------------------------------------------------------------------------

/**
 * Runs fn with the session user, mode and clock preset in the request memo, so every
 * getSessionUser / currentMode / getClock inside (the pipeline, markSent, ...) sees the demo
 * account at the pinned clock, whoever made the request. Same request id and log lines.
 */
export function actAs<T>(memo: { user: SessionUser | null; mode: ResolvedMode; clock: AppClock }, fn: () => Promise<T>): Promise<T> {
  const outer = currentRequest();
  const store = {
    ...(outer ?? { reqId: shortId("req"), startedAt: performance.now(), lines: [] }),
    memo: new Map<string, unknown>([
      [SESSION_MEMO_KEY, memo.user],
      [MODE_MEMO_KEY, memo.mode],
      [CLOCK_MEMO_KEY, memo.clock],
    ]),
  };
  return requestStorage.run(store, fn);
}

async function loadDemoUser(id: string): Promise<SessionUser> {
  const [u] = await q("demo.account.load", (db) =>
    db.select({ id: t.users.id, email: t.users.email, role: t.users.role, status: t.users.status, employeeId: t.users.employeeId, createdAt: t.users.createdAt, isDemo: t.users.isDemo }).from(t.users).where(eq(t.users.id, id)).limit(1),
  );
  if (!u) throw new AppError("DEMO_RESET_FAILED", `demo account ${id} vanished during the reset`);
  return { ...u, approved: u.status === "approved" };
}

async function resetProfile(userId: string, personaId: string): Promise<void> {
  const d = await contextDefaults(personaId);
  const now = wallNow();
  const values = { knownSkillIds: d.knownSkillIds, firstFocus: DEMO_FOCUS, preferredChannel: "slack" as const, okToInterruptSeniors: false, roleConfirmedAt: now, contextAt: now, channelsAt: now, completedAt: now, usedDefaults: false, updatedAt: now };
  await q("demo.profile.upsert", (db) => db.insert(t.userProfiles).values({ userId, ...values }).onConflictDoUpdate({ target: t.userProfiles.userId, set: values }));
  log.info(`demo reset profile ${userId}: known skills ${d.knownSkillIds.join(", ") || "none"}, focus "${DEMO_FOCUS}", Slack, peers first`);
}

// ---------------------------------------------------------------------------
// building one demo ask through the real pipeline
// ---------------------------------------------------------------------------

async function stateOf(askId: string): Promise<AskState> {
  const [r] = await q("demo.ask.state", (db) => db.select({ status: t.asks.status }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
  return r.status;
}

async function runTo(askId: string, want: AskState, key: string): Promise<void> {
  const out = await runAskPipeline(askId, { paceMs: 0 });
  if (out.state !== want) {
    throw new AppError("DEMO_RESET_FAILED", `demo ask ${key} (${askId}) stopped in ${out.state}, expected ${want}: ${out.stoppedBecause}`, { context: { askId, key } });
  }
}

/** Moves an ask's wall and app timestamps back, so history reads as history (ages, follow-up, load window). */
async function backdate(askId: string, days: number): Promise<void> {
  if (!days) return;
  const shiftMs = days * DAY_MS;
  const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(new Date(v).getTime() - shiftMs).toISOString() : v);
  const [a] = await q("demo.backdate.load", (db) => db.select({ ranking: t.asks.ranking, draft: t.asks.draft }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
  const ranking = a?.ranking ? { ...(a.ranking as Record<string, unknown>), rankedAt: iso((a.ranking as Record<string, unknown>).rankedAt) } : null;
  const draft = a?.draft as Record<string, unknown> | null;
  const sent = draft?.sent as Record<string, unknown> | undefined;
  const draftOut = draft ? { ...draft, ...(sent ? { sent: { ...sent, at: iso(sent.at), appAt: iso(sent.appAt) } } : {}) } : null;
  const i = sql`make_interval(days => ${days})`;
  await getDb().transaction(async (tx) => {
    await qIn(tx, "demo.backdate.ask", (h) =>
      h.execute(sql`update asks set created_at = created_at - ${i}, updated_at = updated_at - ${i}, resolved_at = resolved_at - ${i}, sent_at = sent_at - ${i}, sent_app_at = sent_app_at - ${i}, progress_at = progress_at - ${i}, ranking = ${ranking ? JSON.stringify(ranking) : null}::jsonb, draft = ${draftOut ? JSON.stringify(draftOut) : null}::jsonb where id = ${askId}`),
    );
    await qIn(tx, "demo.backdate.events", (h) => h.execute(sql`update ask_events set at = at - ${i} where ask_id = ${askId}`));
    await qIn(tx, "demo.backdate.candidates", (h) => h.execute(sql`update ask_candidates set created_at = created_at - ${i} where ask_id = ${askId}`));
    await qIn(tx, "demo.backdate.docs", (h) => h.execute(sql`update ask_doc_checks set created_at = created_at - ${i}, verdict_at = verdict_at - ${i} where ask_id = ${askId}`));
    await qIn(tx, "demo.backdate.messages", (h) => h.execute(sql`update ask_messages set created_at = created_at - ${i}, updated_at = updated_at - ${i} where ask_id = ${askId}`));
  });
  log.debug(`demo reset backdated ${askId} by ${days} days (wall and app time)`);
}

/** Who a demo ask belongs to: the demo account, or (record script only) a signed-out visitor. */
export type DemoOwner = { user: SessionUser | null; visitorId: string | null; personaId: string };

/**
 * One ask through the real pipeline as the asker would take it: confirm the reading (or the
 * document), pick the #1 on the shortlist, send the suggested draft, say they answered. Must run
 * inside actAs, which presets the session user, mode and clock.
 */
export async function buildDemoAsk(def: DemoAskDef, owner: DemoOwner): Promise<DemoAskRef> {
  const { user, personaId } = owner;
  const actorId = user?.id ?? owner.visitorId ?? "visitor";
  const viewer: Viewer = { user, visitorId: owner.visitorId, personaId, isAdmin: false, actorId };
  const askId = await insertAndSubmitAsk({
    userId: user?.id ?? null,
    visitorId: owner.visitorId,
    personaId,
    actorId,
    source: "demo",
    body: def.body,
    tried: def.tried || null,
    urgency: def.urgency,
    confidential: null,
    reason: `submitted by the demo reset (${def.key})`,
  });
  await runTo(askId, "confirming", def.key);

  // The confirm screen, as the asker would fill it: the reading as is, plus the service if missed.
  const [row] = await q("demo.ask.understanding", (db) => db.select({ understanding: t.asks.understanding }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
  const u = normalizeUnderstanding(row?.understanding);
  if (!u) throw new AppError("DEMO_RESET_FAILED", `demo ask ${def.key} (${askId}) has no understanding after the understanding step`);
  const serviceIds = u.services.map((s) => s.id);
  if (def.confirmService && !serviceIds.includes(def.confirmService)) {
    serviceIds.push(def.confirmService);
    log.branch(`demo reset ${def.key}: add ${def.confirmService} on the confirm screen`, `the ${u.via} reading named ${u.services.map((s) => s.id).join(", ") || "no service"}`);
  }
  let answeredByDocId: string | null = null;
  if (def.outcome.kind === "doc_answered") {
    const docId = def.outcome.docId;
    const [offered] = await q("demo.ask.doc_offered", (db) => db.select({ id: t.askDocChecks.documentId }).from(t.askDocChecks).where(and(eq(t.askDocChecks.askId, askId), eq(t.askDocChecks.documentId, docId))).limit(1));
    if (offered) answeredByDocId = docId;
    else log.warn(`demo reset ${def.key}: ${docId} was not offered for ${askId}, so the ask goes on to find a person instead`);
  }
  await confirmAsk(
    { askId, restatement: u.restatement, serviceIds, skillIds: u.skills.map((s) => s.id), artifacts: u.artifacts, helpKind: u.helpKind, urgency: u.urgency, sensitive: u.sensitive, answeredByDocId },
    viewer,
  );
  let recipientId: string | null = null;
  if (!answeredByDocId) {
    await runTo(askId, "shortlist", def.key);
    const [r] = await q("demo.ask.ranking", (db) => db.select({ ranking: t.asks.ranking }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
    const top = asRanking(r?.ranking)?.shortlistIds[0];
    if (!top) throw new AppError("DEMO_RESET_FAILED", `demo ask ${def.key} (${askId}) has an empty shortlist`);
    recipientId = top;
    await chooseCandidate({ askId, employeeId: top, tune: 0, shownRank: 1 }, viewer);
    await runTo(askId, "ready", def.key);
    if (def.outcome.kind === "sent" || def.outcome.kind === "answered") {
      const [d] = await q("demo.ask.draft", (db) => db.select({ draft: t.asks.draft }).from(t.asks).where(eq(t.asks.id, askId)).limit(1));
      const s = asDraftSummary(d?.draft);
      if (!s) throw new AppError("DEMO_RESET_FAILED", `demo ask ${def.key} (${askId}) is ready without a draft`);
      const [m] = await q("demo.ask.message", (db) =>
        db.select({ subject: t.askMessages.subject, body: t.askMessages.body }).from(t.askMessages).where(and(eq(t.askMessages.askId, askId), eq(t.askMessages.variant, s.suggested.variant))).limit(1),
      );
      await markSent({ askId, variant: s.suggested.variant, format: s.suggested.format, subject: m?.subject ?? "", body: m?.body ?? "" }, viewer);
      if (def.outcome.kind === "answered") await markAnswered({ askId, note: def.outcome.note }, viewer);
    }
  }
  await backdate(askId, def.daysAgo);
  const state = await stateOf(askId);
  log.info(`demo reset created ${def.key} ${askId}: ${state}${recipientId ? ` (shortlist #1 ${recipientId})` : ""}${def.daysAgo ? `, ${def.daysAgo} days ago` : ""}`, { askId });
  return { key: def.key, askId, state, recipientId };
}

/** "I sent this" for the guided ask with its suggested draft, as the demo account (the record script's second phase). */
export async function markGuidedSent(state: DemoState): Promise<{ loadBefore: number; loadAfter: number }> {
  const user = await loadDemoUser(state.accountId);
  const clock = await demoClock("guided send");
  const mode = await resolveMode(user, "auto");
  return actAs({ user, mode, clock }, async () => {
    const [d] = await q("demo.guided.draft", (db) => db.select({ draft: t.asks.draft }).from(t.asks).where(eq(t.asks.id, state.guidedAskId)).limit(1));
    const s = asDraftSummary(d?.draft);
    if (!s) throw new AppError("DEMO_RESET_FAILED", `guided ask ${state.guidedAskId} has no draft`);
    const [m] = await q("demo.guided.message", (db) => db.select({ subject: t.askMessages.subject, body: t.askMessages.body }).from(t.askMessages).where(and(eq(t.askMessages.askId, state.guidedAskId), eq(t.askMessages.variant, s.suggested.variant))).limit(1));
    const viewer: Viewer = { user, visitorId: null, personaId: state.personaId, isAdmin: false, actorId: user.id };
    const r = await markSent({ askId: state.guidedAskId, variant: s.suggested.variant, format: s.suggested.format, subject: m?.subject ?? "", body: m?.body ?? "" }, viewer);
    return { loadBefore: r.loadBefore, loadAfter: r.loadAfter };
  });
}

/** Removes one ask and everything hanging off it (the record script cleans up after each example). */
export async function deleteDemoAsk(askId: string): Promise<void> {
  await q("demo.ask.delete", (db) => db.delete(t.asks).where(and(eq(t.asks.id, askId), eq(t.asks.source, "demo"))));
  log.debug(`deleted demo ask ${askId}`);
}

export { loadDemoUser };

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

async function takeLock(): Promise<string | null> {
  const until = new Date(wallMs() + LOCK_S * 1000).toISOString();
  const rows = await q("demo.lock.take", (db) =>
    db.execute<{ key: string }>(sql`
      insert into app_meta (key, value) values (${LOCK_KEY}, ${until})
      on conflict (key) do update set value = excluded.value, updated_at = now()
      where app_meta.value::timestamptz < now()
      returning key`),
  );
  return rows.length ? until : null;
}

async function releaseLock(until: string): Promise<void> {
  await q("demo.lock.release", (db) => db.delete(t.appMeta).where(and(eq(t.appMeta.key, LOCK_KEY), eq(t.appMeta.value, until))));
}

/**
 * Reset demo. `mode` is only for the owner's record script: the history and guided ask then run in
 * that mode (live, inside runAsScript) instead of the demo account's own (always demo).
 */
export async function resetDemo(by: string, opts: { mode?: ResolvedMode } = {}): Promise<DemoResetReport> {
  const t0 = performance.now();
  const lock = await takeLock();
  if (!lock) {
    log.warn(`demo reset by ${by} refused: another reset holds the lock (it frees itself after ${LOCK_S}s)`);
    throw new AppError("DEMO_RESET_BUSY", undefined, { status: 409 });
  }
  try {
    log.info(`demo reset by ${by}: start${opts.mode ? ` (mode ${opts.mode.mode} from the owner's script: ${opts.mode.reason})` : ""}`);
    const personaId = await demoPersonaId();
    if (!personaId) {
      log.error(`demo reset refused: seed.planted has no ${DEMO_PERSONA_KEY} (seeded before prompt 10?); reseed to add the demo persona`);
      throw new AppError("DEMO_NOT_READY", undefined, { status: 503 });
    }
    const clock = await demoClock("demo reset");
    const people = await q("demo.people", (db) => db.select({ id: t.employees.id, name: t.employees.name }).from(t.employees));
    const ids = people.map((p) => p.id);
    const before = await loadsThisWeek(ids, clock.now);

    // 1. delete every demo ask and what hangs off it
    const account = await ensureDemoAccount(personaId);
    const demoAsks = await q("demo.reset.asks", (db) => db.select({ id: t.asks.id, status: t.asks.status, userId: t.asks.userId }).from(t.asks).where(eq(t.asks.source, "demo")));
    const askIds = demoAsks.map((a) => a.id);
    const count = async (label: string, table: typeof t.askEvents | typeof t.askCandidates | typeof t.askDocChecks | typeof t.askMessages) =>
      askIds.length ? Number((await q(`demo.reset.count.${label}`, (db) => db.select({ n: sql<number>`count(*)::int` }).from(table).where(inArray(table.askId, askIds))))[0].n) : 0;
    const [events, candidates, docChecks, messages] = await Promise.all([count("events", t.askEvents), count("candidates", t.askCandidates), count("docs", t.askDocChecks), count("messages", t.askMessages)]);
    const rampOwner = or(eq(t.rampPlans.owner, account.id), like(t.rampPlans.owner, "vis_%"));
    const dismissOwner = or(eq(t.rampDismissals.owner, account.id), like(t.rampDismissals.owner, "vis_%"));
    const { rampPlans, rampDismissals, askLimits } = await getDb().transaction(async (tx) => {
      if (askIds.length) await qIn(tx, "demo.reset.delete_asks", (h) => h.delete(t.asks).where(eq(t.asks.source, "demo")));
      const rp = await qIn(tx, "demo.reset.delete_ramp", (h) => h.delete(t.rampPlans).where(rampOwner).returning({ id: t.rampPlans.id }));
      const rd = await qIn(tx, "demo.reset.delete_dismissals", (h) => h.delete(t.rampDismissals).where(dismissOwner).returning({ id: t.rampDismissals.id }));
      // The new-ask limit exists so a public demo cannot fill the database; the asks it counted are
      // gone now. Judges on one venue network share an address, so it starts over too.
      const rl = await qIn(tx, "demo.reset.ask_limits", (h) => h.delete(t.rateLimits).where(like(t.rateLimits.key, "ask:%")).returning({ key: t.rateLimits.key }));
      return { rampPlans: rp.length, rampDismissals: rd.length, askLimits: rl.length };
    });
    const byState: Record<string, number> = {};
    for (const a of demoAsks) byState[a.status] = (byState[a.status] ?? 0) + 1;
    const accountAsks = demoAsks.filter((a) => a.userId === account.id).length;
    const deleted = { asks: demoAsks.length, byState, events, candidates, docChecks, messages, rampPlans, rampDismissals, askLimits, accountAsks, visitorAsks: demoAsks.length - accountAsks };
    log.info(
      `demo reset deleted ${deleted.asks} demo asks (${accountAsks} from the demo account, ${deleted.visitorAsks} from signed-out visitors; by state ${JSON.stringify(byState)}), ${events} events, ${candidates} candidates, ${docChecks} doc checks, ${messages} drafts, ${rampPlans} ramp plans, ${rampDismissals} ramp dismissals, ${askLimits} new-ask rate limit windows`,
      { askIds: askIds.slice(0, 50) },
    );
    const mid = await loadsThisWeek(ids, clock.now);

    // 2. the account and its profile
    await resetProfile(account.id, personaId);
    const user = await loadDemoUser(account.id);
    const mode = opts.mode ?? (await resolveMode(user, "auto"));
    if (account.created || account.relinked) log.info(`demo reset account ${account.id}: ${account.created ? "created" : "re-linked"} to ${personaId}`);
    log.info(`demo reset clock: ${clock.pinned ? "pinned" : "NOT pinned"} at ${clockLabel(clock.now)} (${clock.now.toISOString()}), ${clock.reason}; the app clock never moves, so nothing else to restore`);

    // 3. history and the guided ask, through the real pipeline as the demo account
    const { created, ramp } = await actAs({ user, mode, clock }, async () => {
      const out: DemoAskRef[] = [];
      for (const def of [...DEMO_HISTORY, GUIDED_ASK]) out.push(await buildDemoAsk(def, { user, visitorId: null, personaId }));
      // This week's ramp plan, built now so /dashboard and /ramp open on it.
      const view = await getRampView("this");
      return { created: out, ramp: view.plan?.status ?? "none" };
    });
    log.info(`demo reset ramp plan for ${account.id}: ${ramp}`);
    const guided = created.find((c) => c.key === GUIDED_ASK.key)!;

    // 4. what moved
    const after = await loadsThisWeek(ids, clock.now);
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const loads = ids
      .filter((id) => (before.get(id) ?? 0) !== (after.get(id) ?? 0) || (mid.get(id) ?? 0) !== (after.get(id) ?? 0))
      .map((id) => ({ id, name: nameOf.get(id) ?? id, before: before.get(id) ?? 0, after: after.get(id) ?? 0 }));
    for (const l of loads) log.info(`demo reset load ${l.id} ${l.name}: ${l.before} -> ${l.after} asks this week${(mid.get(l.id) ?? 0) !== l.after ? ` (${mid.get(l.id) ?? 0} after the delete, then the rebuilt history sent to them)` : " (back to the seed)"}`);
    if (!loads.length) log.info("demo reset load: no counter changed (no demo send since the last reset)");

    const ms = Math.round(performance.now() - t0);
    const state: DemoState = { version: 1, accountId: account.id, personaId, guidedAskId: guided.askId, history: created.filter((c) => c.key !== GUIDED_ASK.key), resetAt: wallNow().toISOString(), resetBy: by, ms, clock: clock.now.toISOString() };
    await q("demo.state.write", (db) =>
      db.insert(t.appMeta).values({ key: STATE_KEY, value: JSON.stringify(state) }).onConflictDoUpdate({ target: t.appMeta.key, set: { value: JSON.stringify(state), updatedAt: sql`now()` } }),
    );
    log.info(
      `demo reset done in ${ms}ms by ${by}: deleted ${deleted.asks} asks, ${loads.length} load counters changed, history ${state.history.map((h) => `${h.askId} ${h.key} ${h.state}`).join(", ")}; guided ${guided.askId} ${guided.state} for ${guided.recipientId}; clock pinned ${clockLabel(clock.now)}`,
    );
    return { ms, by, deleted, loads, created, guidedAskId: guided.askId, clock: clockLabel(clock.now) };
  } catch (err) {
    const e = toAppError(err, "DEMO_RESET_FAILED");
    log.error(`demo reset by ${by} failed with ${e.code}`, { err });
    throw e.code === "UNKNOWN" ? new AppError("DEMO_RESET_FAILED", e.message, { cause: err }) : e;
  } finally {
    await releaseLock(lock);
  }
}
