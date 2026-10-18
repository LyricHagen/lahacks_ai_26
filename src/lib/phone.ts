import "server-only";
// Draft delivery to the asker's own phone over Photon (FEATURE_PHOTON). Three moves, all logged
// under [phone] with the account id, never with message text or the full number:
//
//   link      /account: the person enters their own number and gets a 6 digit code. Nothing is sent.
//             They text "LINK 123456" to the agent's number FROM that number. Inbound only: the app
//             never starts a conversation, and the code proves the number is theirs.
//   deliver   the draft page: "Text it to my phone" replies in the space their LINK message opened.
//   confirm   they send the message themselves from their real messaging app, then reply SENT. That
//             runs the same markSent as the "I sent this" button (ready -> sent, recipient load +1).
//
// THE rule: replyTo() is the only function here that sends, and it takes a linked row (a space
// opened by that account's own number). An unknown sender, a pending number with a wrong code, a
// group chat: logged and ignored, never answered.
//
// Inbound is polled (GET messages) by syncInbound: from the /account and draft pages while they wait,
// from pnpm photon:listen, or from a scheduler with PHOTON_SYNC_SECRET. Each message is claimed once
// in photon_inbound (insert on conflict do nothing), so overlapping polls never answer twice.

import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { markSent } from "./ask-outcome";
import type { DraftSummary } from "./ask-draft-step";
import type { SessionUser } from "./auth";
import { systemClock, wallMs, wallNow } from "./clock";
import { demoClock } from "./clock-server";
import { actAs } from "./demo";
import { type DraftFormat, type DraftVariant, FORMAT_LABEL, VARIANT_DEF } from "./draft";
import { AppError } from "./errors";
import { flagOn } from "./flags";
import { createLogger, markSensitive } from "./log";
import { resolveMode } from "./mode";
import { agentHandle, type InboundMessage, listReceived, photonConfigured, sendText } from "./photon";

const log = createLogger("phone");

const CODE_MINUTES = 30;
const CURSOR_KEY = "photon.cursor";
/** Look back this far on the first poll, and overlap every poll by a little (dedupe handles repeats). */
const FIRST_LOOKBACK_MS = 60 * 60 * 1000;
const OVERLAP_MS = 15_000;
/** A SENT reply confirms the newest delivery from the last 7 days. */
const CONFIRM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type PhoneRow = typeof t.userPhones.$inferSelect;

/** "+1 (415) 555-0123" -> "+14155550123"; 10 digits get +1; an email is lowercased. Null if neither. */
export function normalizeHandle(raw: string): string | null {
  const v = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v.toLowerCase();
  const digits = v.replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

/** For log lines: +1415...0123, a...@example.com. */
export function maskHandle(h: string): string {
  if (h.includes("@")) return `${h[0]}...@${h.split("@")[1]}`;
  return h.length > 8 ? `${h.slice(0, 5)}...${h.slice(-4)}` : "...";
}

function requireOn(what: string): void {
  if (!flagOn("photon", what)) throw new AppError("PHOTON_NOT_CONFIGURED", "Texting drafts to your phone is turned off on this server.", { status: 404 });
  const c = photonConfigured();
  if (!c.ok) {
    log.warn(`${what} refused: FEATURE_PHOTON is on but ${c.missing.join(", ")} not set`);
    throw new AppError("PHOTON_NOT_CONFIGURED", undefined, { status: 503 });
  }
}

export type PhoneView = { enabled: boolean; configured: boolean; agentHandle: string | null; status: "none" | "pending" | "linked"; handle: string | null; code: string | null; codeExpiresAt: string | null; linkedAt: string | null };

export async function getPhoneView(user: SessionUser): Promise<PhoneView> {
  const enabled = flagOn("photon", `phone view for ${user.id}`);
  const configured = photonConfigured().ok;
  if (!enabled) return { enabled, configured, agentHandle: null, status: "none", handle: null, code: null, codeExpiresAt: null, linkedAt: null };
  const [row] = await q("phone.view", (db) => db.select().from(t.userPhones).where(eq(t.userPhones.userId, user.id)).limit(1));
  const expired = row?.status === "pending" && (!row.codeExpiresAt || row.codeExpiresAt.getTime() < wallMs());
  log.debug(`phone view ${user.id}: ${row ? `${row.status}${expired ? " (code expired)" : ""} ${maskHandle(row.handle)}` : "no phone"}`);
  return {
    enabled,
    configured,
    agentHandle: agentHandle(),
    status: row ? (row.status as "pending" | "linked") : "none",
    handle: row?.handle ?? null,
    code: row?.status === "pending" && !expired ? row.linkCode : null,
    codeExpiresAt: row?.status === "pending" && !expired ? (row.codeExpiresAt?.toISOString() ?? null) : null,
    linkedAt: row?.linkedAt?.toISOString() ?? null,
  };
}

/** Save the account's number as pending and hand back the code to text. Sends nothing. */
export async function startLink(user: SessionUser, rawHandle: string): Promise<{ code: string; agentHandle: string; expiresAt: string }> {
  requireOn(`link for ${user.id}`);
  if (user.isDemo) {
    log.warn(`phone link refused for ${user.id}: the shared demo account cannot hold anyone's number`);
    throw new AppError("FORBIDDEN", "The shared demo account cannot link a phone. Sign up for your own account.", { status: 403 });
  }
  const handle = normalizeHandle(rawHandle);
  if (!handle) {
    log.info(`phone link refused for ${user.id}: input is not E.164 or an email (${rawHandle.length} chars)`);
    throw new AppError("PHOTON_INVALID_PHONE", undefined, { status: 400 });
  }
  markSensitive(handle);
  const [taken] = await q("phone.link.taken", (db) => db.select({ userId: t.userPhones.userId }).from(t.userPhones).where(eq(t.userPhones.handle, handle)).limit(1));
  if (taken && taken.userId !== user.id) {
    log.warn(`phone link refused for ${user.id}: ${maskHandle(handle)} is already held by ${taken.userId}`);
    throw new AppError("PHOTON_INVALID_PHONE", "That number cannot be linked to this account.", { status: 409 });
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(wallMs() + CODE_MINUTES * 60_000);
  const values = { handle, status: "pending", linkCode: code, codeExpiresAt: expiresAt, platform: null, spaceId: null, agentUserId: null, linkedAt: null, updatedAt: wallNow() };
  await q("phone.link.upsert", (db) => db.insert(t.userPhones).values({ userId: user.id, ...values }).onConflictDoUpdate({ target: t.userPhones.userId, set: values }));
  log.info(`phone link started for ${user.id}: ${maskHandle(handle)} pending, code expires ${expiresAt.toISOString()} (waiting for them to text LINK from that number)`);
  return { code, agentHandle: agentHandle()!, expiresAt: expiresAt.toISOString() };
}

export async function unlink(user: SessionUser, why: string): Promise<void> {
  const rows = await q("phone.unlink", (db) => db.delete(t.userPhones).where(eq(t.userPhones.userId, user.id)).returning({ handle: t.userPhones.handle }));
  log.info(`phone unlinked for ${user.id}: ${rows[0] ? maskHandle(rows[0].handle) : "nothing was linked"} (${why})`);
}

/** THE only send in this module: a reply in the space a linked number opened. */
async function replyTo(row: PhoneRow, text: string, idem: string, label: string, parentMessageId?: string): Promise<string | null> {
  if (row.status !== "linked" || !row.spaceId || !row.agentUserId) {
    log.error(`refused to send ${label} for ${row.userId}: number ${maskHandle(row.handle)} is ${row.status}, not linked with a space (this is a bug)`);
    throw new AppError("PHOTON_NOT_LINKED", undefined, { status: 409 });
  }
  return sendText({ spaceId: row.spaceId, senderId: row.agentUserId, parentMessageId, text, idempotencyKey: idem, label: `${label} to ${row.userId} ${maskHandle(row.handle)}` });
}

/** The draft as a text: who it is for, how to send it, and the SENT reply. */
function deliveryText(s: DraftSummary, f: { variant: DraftVariant; format: DraftFormat; subject: string; body: string }): string {
  const how = f.format === "email" ? `email it to ${s.recipient.email}` : f.format === "invite" ? `send it as a calendar invite to ${s.recipient.email}` : `DM it to ${s.recipient.slackHandle} on Slack`;
  return [
    `Altostratus draft for ${s.recipient.name} (${FORMAT_LABEL[f.format]}, ${VARIANT_DEF[f.variant].label.toLowerCase()}):`,
    "",
    ...(f.subject.trim() && f.format !== "slack" ? [`Subject: ${f.subject.trim()}`, ""] : []),
    f.body.trim(),
    "",
    `Copy it and ${how} yourself. Reply SENT here once it is sent.`,
  ].join("\n");
}

/** Text the on-screen draft to the account's own linked phone. */
export async function deliverDraft(user: SessionUser, f: { askId: string; variant: DraftVariant; format: DraftFormat; subject: string; body: string }): Promise<{ deliveryId: number; to: string }> {
  requireOn(`deliver ${f.askId} for ${user.id}`);
  const [ask] = await q("phone.deliver.ask", (db) => db.select({ userId: t.asks.userId, status: t.asks.status, draft: t.asks.draft }).from(t.asks).where(eq(t.asks.id, f.askId)).limit(1));
  if (!ask || ask.userId !== user.id) {
    log.warn(`deliver refused: ${f.askId} is not ${user.id}'s own ask (${ask ? `belongs to ${ask.userId ?? "a visitor"}` : "missing"})`, { askId: f.askId });
    throw new AppError("ASK_NOT_FOUND", undefined, { status: 404 });
  }
  if (ask.status !== "ready" || !ask.draft) {
    log.info(`deliver refused: ${f.askId} is ${ask.status}, not ready with a draft`, { askId: f.askId });
    throw new AppError("ASK_ILLEGAL_TRANSITION", "Only a ready draft can be texted.", { status: 409 });
  }
  const [row] = await q("phone.deliver.row", (db) => db.select().from(t.userPhones).where(eq(t.userPhones.userId, user.id)).limit(1));
  if (!row || row.status !== "linked") {
    log.info(`deliver refused for ${user.id}: phone ${row ? row.status : "not set"}`, { askId: f.askId });
    throw new AppError("PHOTON_NOT_LINKED", undefined, { status: 409 });
  }
  const s = ask.draft as DraftSummary;
  const text = deliveryText(s, f);
  const [d] = await q("phone.deliver.insert", (db) =>
    db.insert(t.phoneDeliveries).values({ userId: user.id, askId: f.askId, variant: f.variant, format: f.format, subject: f.subject, body: f.body, status: "pending" }).returning({ id: t.phoneDeliveries.id }),
  );
  try {
    const idem = `altostratus-delivery-${d.id}`;
    const id = await replyTo(row, text, idem, `draft ${f.askId} (${f.variant}/${f.format}, ${text.length} chars)`);
    await q("phone.deliver.accepted", (db) => db.update(t.phoneDeliveries).set({ status: "accepted", photonMessageId: id }).where(eq(t.phoneDeliveries.id, d.id)));
    log.info(`${f.askId} draft delivered to ${user.id}'s phone ${maskHandle(row.handle)} as delivery ${d.id} (photon ${id ?? "no id"}); waiting for a SENT reply`, { askId: f.askId });
    return { deliveryId: d.id, to: maskHandle(row.handle) };
  } catch (err) {
    const code = err instanceof AppError ? err.code : "PHOTON_SEND_FAILED";
    log.error(`${f.askId} draft delivery ${d.id} to ${user.id} failed with ${code}`, { err, askId: f.askId });
    await q("phone.deliver.failed", (db) => db.update(t.phoneDeliveries).set({ status: "failed", errorCode: code }).where(eq(t.phoneDeliveries.id, d.id)));
    throw err instanceof AppError ? err : new AppError("PHOTON_SEND_FAILED", undefined, { status: 502, cause: err });
  }
}

export type DeliveryView = { id: number; status: string; at: string; confirmedAt: string | null } | null;

/** The newest delivery of this ask to the account's phone, for the draft page. */
export async function latestDelivery(userId: string, askId: string): Promise<DeliveryView> {
  const [d] = await q("phone.delivery.latest", (db) =>
    db.select().from(t.phoneDeliveries).where(and(eq(t.phoneDeliveries.userId, userId), eq(t.phoneDeliveries.askId, askId))).orderBy(desc(t.phoneDeliveries.createdAt)).limit(1),
  );
  return d ? { id: d.id, status: d.status, at: d.createdAt.toISOString(), confirmedAt: d.confirmedAt?.toISOString() ?? null } : null;
}

// ---------------------------------------------------------------------------
// inbound
// ---------------------------------------------------------------------------

export type SyncResult = { polled: number; handled: number; outcomes: Record<string, number> };

/** Read new inbound texts and act on each once. Safe to call from several places at once. */
export async function syncInbound(trigger: string): Promise<SyncResult> {
  requireOn(`inbound sync (${trigger})`);
  const [cur] = await q("phone.cursor.get", (db) => db.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, CURSOR_KEY)).limit(1));
  const since = cur?.value ?? new Date(wallMs() - FIRST_LOOKBACK_MS).toISOString();
  log.info(`inbound sync (${trigger}) since ${since}${cur ? "" : " (first poll, looking back 1 hour)"}`);
  const messages = await listReceived(since);
  const outcomes: Record<string, number> = {};
  let handled = 0;
  let newest = Date.parse(since);
  for (const m of messages) {
    newest = Math.max(newest, Date.parse(m.createdAt));
    const outcome = await handleOnce(m);
    if (outcome) {
      handled++;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
  }
  const next = new Date(Math.max(Date.parse(since), newest - OVERLAP_MS)).toISOString();
  await q("phone.cursor.set", (db) => db.insert(t.appMeta).values({ key: CURSOR_KEY, value: next }).onConflictDoUpdate({ target: t.appMeta.key, set: { value: next, updatedAt: wallNow() } }));
  log.info(`inbound sync (${trigger}) done: ${messages.length} polled, ${handled} new, outcomes ${JSON.stringify(outcomes)}, cursor ${next}`);
  return { polled: messages.length, handled, outcomes };
}

/** Claim the message (first caller wins), then handle it. Null when another poll already did. */
async function handleOnce(m: InboundMessage): Promise<string | null> {
  const claimed = await q("phone.inbound.claim", (db) =>
    db.insert(t.photonInbound).values({ messageId: m.id, handle: m.fromHandle, outcome: "processing", receivedAt: new Date(m.createdAt) }).onConflictDoNothing().returning({ id: t.photonInbound.messageId }),
  );
  if (!claimed.length) {
    log.trace(`inbound ${m.id} already handled, skipping`);
    return null;
  }
  let outcome = "error";
  let userId: string | null = null;
  try {
    const r = await handle(m);
    outcome = r.outcome;
    userId = r.userId;
  } catch (err) {
    log.error(`inbound ${m.id} from ${maskHandle(m.fromHandle)} failed while handling`, { err });
    outcome = `error_${err instanceof AppError ? err.code.toLowerCase() : "unknown"}`;
  }
  await q("phone.inbound.done", (db) => db.update(t.photonInbound).set({ outcome, userId, handledAt: wallNow() }).where(eq(t.photonInbound.messageId, m.id)));
  return outcome;
}

async function handle(m: InboundMessage): Promise<{ outcome: string; userId: string | null }> {
  const handle = normalizeHandle(m.fromHandle) ?? m.fromHandle;
  const [row] = await q("phone.inbound.row", (db) => db.select().from(t.userPhones).where(eq(t.userPhones.handle, handle)).limit(1));
  const words = (m.text ?? "").trim();
  const head = `inbound ${m.id} ${m.platform} from ${maskHandle(handle)} (${m.fromKind}, ${m.spaceKind} space, ${words.length} chars)`;
  if (!row) {
    log.info(`${head}: no account holds this number, ignored and NOT answered`);
    return { outcome: "ignored_unknown_sender", userId: null };
  }
  if (m.fromKind && m.fromKind !== "human") {
    log.info(`${head}: sender kind ${m.fromKind}, ignored`);
    return { outcome: "ignored_not_human", userId: row.userId };
  }
  if (m.spaceKind && m.spaceKind !== "direct") {
    log.info(`${head}: not a one to one conversation, ignored and NOT answered (replies only go to the person's own direct chat)`);
    return { outcome: "ignored_group", userId: row.userId };
  }

  const link = words.match(/^link\s*(\d{6})$/i);
  if (row.status === "pending") {
    if (!link) {
      log.info(`${head}: number is pending for ${row.userId} and this is not LINK <code>, ignored and NOT answered`);
      return { outcome: "ignored_pending", userId: row.userId };
    }
    const expired = !row.codeExpiresAt || row.codeExpiresAt.getTime() < wallMs();
    if (link[1] !== row.linkCode || expired) {
      log.warn(`${head}: LINK code for ${row.userId} ${expired ? "expired" : "does not match"}, NOT linked and NOT answered`);
      return { outcome: expired ? "link_code_expired" : "link_code_mismatch", userId: row.userId };
    }
    const [linked] = await q("phone.inbound.linked", (db) =>
      db
        .update(t.userPhones)
        .set({ status: "linked", platform: m.platform, spaceId: m.spaceId, agentUserId: m.agentUserId, lastInboundId: m.id, linkedAt: wallNow(), linkCode: null, codeExpiresAt: null, updatedAt: wallNow() })
        .where(eq(t.userPhones.userId, row.userId))
        .returning(),
    );
    log.info(`${head}: LINKED to ${row.userId} (space ${m.spaceId}, ${m.platform})`);
    await replyTo(linked, "Linked to Altostratus. Drafts you choose to text yourself will arrive here; send them from your own apps and reply SENT. Reply STOP to unlink.", `altostratus-linked-${m.id}`, "link confirmation", m.id);
    return { outcome: "linked", userId: row.userId };
  }

  // Linked: the space may have changed (a new conversation); keep the newest one this number opened.
  if (m.spaceId && m.spaceId !== row.spaceId) {
    log.info(`${head}: ${row.userId} wrote from a new space ${m.spaceId} (was ${row.spaceId}), replying there from now on`);
    await q("phone.inbound.space", (db) => db.update(t.userPhones).set({ spaceId: m.spaceId, agentUserId: m.agentUserId, platform: m.platform, updatedAt: wallNow() }).where(eq(t.userPhones.userId, row.userId)));
    row.spaceId = m.spaceId;
    row.agentUserId = m.agentUserId;
  }
  await q("phone.inbound.last", (db) => db.update(t.userPhones).set({ lastInboundId: m.id }).where(eq(t.userPhones.userId, row.userId)));
  const word = words.toLowerCase().replace(/[.!\s]+$/, "");

  if (["stop", "unlink", "unsubscribe"].includes(word)) {
    await replyTo(row, "Unlinked. Altostratus will not text this number again unless you link it from your account page.", `altostratus-stop-${m.id}`, "stop confirmation", m.id);
    await q("phone.inbound.stop", (db) => db.delete(t.userPhones).where(eq(t.userPhones.userId, row.userId)));
    log.info(`${head}: STOP from ${row.userId}, unlinked`);
    return { outcome: "unlinked", userId: row.userId };
  }

  if (["sent", "done", "sent it", "i sent it", "i sent this"].includes(word)) {
    return confirmSent(row, m, head);
  }

  log.info(`${head}: not a command from ${row.userId}, answered with help`);
  await replyTo(row, "Reply SENT after you send the last draft I texted you, or STOP to unlink. New asks start at the Altostratus web app.", `altostratus-help-${m.id}`, "help", m.id);
  return { outcome: "help", userId: row.userId };
}

/** A SENT reply: mark the newest unconfirmed delivery sent, through the same markSent as the button. */
async function confirmSent(row: PhoneRow, m: InboundMessage, head: string): Promise<{ outcome: string; userId: string }> {
  const since = new Date(wallMs() - CONFIRM_WINDOW_MS);
  const [d] = await q("phone.confirm.delivery", (db) =>
    db
      .select()
      .from(t.phoneDeliveries)
      .where(and(eq(t.phoneDeliveries.userId, row.userId), eq(t.phoneDeliveries.status, "accepted"), gte(t.phoneDeliveries.createdAt, since)))
      .orderBy(desc(t.phoneDeliveries.createdAt))
      .limit(1),
  );
  if (!d) {
    log.info(`${head}: SENT from ${row.userId} but no texted draft is waiting in the last 7 days`);
    await replyTo(row, "There is no texted draft waiting to be confirmed. Text one to yourself from the draft page first.", `altostratus-nothing-${m.id}`, "nothing to confirm", m.id);
    return { outcome: "sent_nothing_waiting", userId: row.userId };
  }
  const [u] = await q("phone.confirm.user", (db) =>
    db.select({ id: t.users.id, email: t.users.email, role: t.users.role, status: t.users.status, employeeId: t.users.employeeId, createdAt: t.users.createdAt, isDemo: t.users.isDemo }).from(t.users).where(eq(t.users.id, row.userId)).limit(1),
  );
  const user: SessionUser = { ...u, approved: u.status === "approved" };
  // Act as the phone's owner for this one block: their session, their mode, their app clock.
  const mode = await resolveMode(user, "auto");
  const clock = mode.mode === "demo" ? await demoClock(`SENT by text from ${user.id}, mode demo (${mode.reason})`) : systemClock(`SENT by text from ${user.id}, mode live`);
  try {
    const r = await actAs({ user, mode, clock }, () =>
      markSent({ askId: d.askId, variant: d.variant, format: d.format, subject: d.subject, body: d.body }, { user, visitorId: null, personaId: user.employeeId, isAdmin: user.role === "admin", actorId: user.id }),
    );
    await q("phone.confirm.done", (db) => db.update(t.phoneDeliveries).set({ status: "confirmed", confirmedAt: wallNow() }).where(eq(t.phoneDeliveries.id, d.id)));
    log.info(`${head}: SENT confirmed ${d.askId} for ${row.userId} (delivery ${d.id}): sent to ${r.recipientName}, load ${r.loadBefore} -> ${r.loadAfter} of ${r.max}`, { askId: d.askId });
    await replyTo(row, `Marked as sent to ${r.recipientName}. Their asks this week: ${r.loadAfter} of ${r.max}. Reply on the web app once they answer.`, `altostratus-sent-${m.id}`, "sent confirmation", m.id);
    return { outcome: "sent_confirmed", userId: row.userId };
  } catch (err) {
    const code = err instanceof AppError ? err.code : "UNKNOWN";
    log.warn(`${head}: SENT for ${d.askId} could not be recorded (${code}); delivery ${d.id} left as is`, { err, askId: d.askId });
    await replyTo(row, code === "ASK_ILLEGAL_TRANSITION" || code === "ASK_STATE_CONFLICT" ? "That ask is no longer waiting to be sent (it was marked on the web, or changed). Nothing else was recorded." : "Could not record that as sent. Use I sent this on the draft page instead.", `altostratus-sentfail-${m.id}`, "sent failure", m.id);
    return { outcome: `sent_failed_${code.toLowerCase()}`, userId: row.userId };
  }
}

/** A scheduler's shared secret for POST /api/photon/sync, compared in constant time. */
export function syncSecretOk(header: string | null): boolean {
  const secret = process.env.PHOTON_SYNC_SECRET;
  if (!secret || !header) return false;
  const a = createHash("sha256").update(header.replace(/^Bearer\s+/i, "")).digest();
  const b = createHash("sha256").update(secret).digest();
  return a.equals(b);
}
