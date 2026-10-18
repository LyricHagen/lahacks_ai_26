import "server-only";
// Read model for the parts of /dashboard that look across asks: which open asks need attention,
// and who the viewer has been asking. Each streams in behind its own skeleton.

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { followUpFor } from "./ask-outcome";
import { ASK_STATE_DEFS, type AskState } from "./ask-state";
import { wallMs } from "./clock";
import { createLogger } from "./log";
import type { Viewer } from "./viewer";

const log = createLogger("dashboard");

/** Sends looked at for "who you asked recently" (wall time: when you really sent them). */
export const RECENT_DAYS = 30;
/** The quiet note shows when one person got at least this many of your recent asks... */
export const REPEAT_MIN = 3;
/** ...and at least this share of them. */
export const REPEAT_SHARE = 0.5;
/** A review screen left this long reads as waiting on you. */
const WAITING_HOURS = 24;

export type Attention = { kind: "stale" | "overdue" | "waiting_on_you"; label: string };

/** Open asks that need the viewer: stale, past the follow-up horizon, or a review screen left open. */
export async function attentionFor(open: Array<{ id: string; status: AskState; updatedAt: Date }>): Promise<Record<string, Attention>> {
  const out: Record<string, Attention> = {};
  for (const a of open) {
    if (a.status === "stale") {
      out[a.id] = { kind: "stale", label: "Stale: follow up or try the next person" };
    } else if (a.status === "sent") {
      const f = await followUpFor(a.id);
      if (f?.overdue) out[a.id] = { kind: "overdue", label: `No answer from ${f.recipientName} within ${f.horizon}: follow up${f.next ? ` or ask ${f.next.name.split(" ")[0]}` : ""}` };
    } else if (ASK_STATE_DEFS[a.status].phase === "review") {
      const hours = (wallMs() - a.updatedAt.getTime()) / 3_600_000;
      if (hours >= WAITING_HOURS) out[a.id] = { kind: "waiting_on_you", label: `Waiting on you for ${Math.floor(hours / 24)}d at ${ASK_STATE_DEFS[a.status].label}` };
    }
  }
  const n = Object.keys(out).length;
  log.info(`dashboard attention: ${n} of ${open.length} open asks need the viewer`, { asks: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.kind])) });
  return out;
}

export type RecentPeople = {
  people: Array<{ id: string; name: string; title: string; team: string; count: number; lastAskId: string; lastAt: Date }>;
  total: number;
  repeat: { id: string; name: string; count: number; total: number } | null;
};

export async function recentRecipients(viewer: Viewer): Promise<RecentPeople> {
  const owner = viewer.user ? eq(t.asks.userId, viewer.user.id) : viewer.visitorId ? eq(t.asks.visitorId, viewer.visitorId) : null;
  if (!owner) {
    log.skip("recent recipients", "signed-out visitor without a visitor cookie has sent nothing");
    return { people: [], total: 0, repeat: null };
  }
  const since = new Date(wallMs() - RECENT_DAYS * 86_400_000);
  const rows = await q("dashboard.recipients", (db) =>
    db
      .select({ askId: t.askEvents.askId, at: t.askEvents.at, recipientId: sql<string>`coalesce(${t.askEvents.data}->>'recipientId', ${t.asks.routedToId})` })
      .from(t.askEvents)
      .innerJoin(t.asks, eq(t.asks.id, t.askEvents.askId))
      .where(and(owner, eq(t.askEvents.toState, "sent"), gte(t.askEvents.at, since)))
      .orderBy(desc(t.askEvents.at)),
  );
  const ids = [...new Set(rows.map((r) => r.recipientId).filter(Boolean))];
  const emps = ids.length ? await q("dashboard.recipients.people", (db) => db.select({ id: t.employees.id, name: t.employees.name, title: t.employees.title, team: t.employees.team }).from(t.employees).where(inArray(t.employees.id, ids))) : [];
  const people = emps
    .map((e) => {
      const mine = rows.filter((r) => r.recipientId === e.id);
      return { ...e, count: mine.length, lastAskId: mine[0].askId, lastAt: mine[0].at };
    })
    .sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime());
  const top = people[0];
  const repeat = top && top.count >= REPEAT_MIN && top.count / rows.length >= REPEAT_SHARE ? { id: top.id, name: top.name, count: top.count, total: rows.length } : null;
  if (repeat) log.branch(`show the spread note for ${repeat.id}`, `${repeat.count} of the last ${repeat.total} sends in ${RECENT_DAYS} days went to ${repeat.name} (at least ${REPEAT_MIN} and ${REPEAT_SHARE * 100}%)`);
  else log.branch("no spread note", top ? `top recipient ${top.id} got ${top.count} of ${rows.length} sends (needs ${REPEAT_MIN} and ${REPEAT_SHARE * 100}%)` : "no sends in the window");
  log.info(`dashboard recipients for ${viewer.actorId}: ${rows.length} sends to ${people.length} people in ${RECENT_DAYS} days`);
  return { people, total: rows.length, repeat };
}
