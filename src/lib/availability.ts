import "server-only";
// Availability: free and busy per employee from calendar_events over a rolling 14 day window, in
// their own time zone and working hours. Pure functions over loaded events plus thin loaders, all
// deterministic given the database and `now` (app time from src/lib/clock.ts), so demo mode needs
// no special path: the demo clock is simply pinned inside the seeded calendar window.
//
// Every calendar block is one of:
//
//   hard busy  meetings, 1:1s, standups, interviews, out of office. Never available.
//   soft busy  focus time. Available only when the urgency allows interrupting it
//              (AVAILABILITY_CONFIG.softInterruptible): someone blocked right now may; someone
//              blocked today can wait for a real gap; someone curious never interrupts.
//   free       anything else inside working hours, including office hours (busy = false).
//
// What it answers:
//
//   analyze / checkAvailability   the next usable window (14 days) plus the ranking horizon score
//   nextWindow(employeeId, minutes, urgency)   one person, with a reason string
//   recommendChannel              call, DM or async message, from urgency and the windows
//   overlapHours(askerId, employeeId)          shared working hours, for time zone scoring
//   loadThisWeek(employeeId)      asks sent to them in the last 7 rolling days (sent events in ask_events)
//   weekStrip                     seven columns of busy density for the UI
//
// Only start, end, kind and busy are read, never titles: /privacy promises free/busy only.
// One INFO line per person per query (`grep "availability emp_113"`): window searched, hard and
// soft block counts, the chosen slot, and the urgency rule behind the channel recommendation.

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import type { AskUrgency } from "./ask-state";
import type { BlockLevel, ChannelRule, Recommendation, StripDay, StripSegment, WeekStripData, WindowView } from "./availability-types";
import { createLogger } from "./log";
import { RANK_CONFIG } from "./rank";
import { addDays, formatDay, localDate, localTime, localToUtc, tzOffsetMinutes, weekday, ZONE_LABEL } from "./time";

const log = createLogger("availability");

/** Asks sent to someone in this many rolling days count as their load this week. */
export const LOAD_WINDOW_DAYS = 7;

export const AVAILABILITY_CONFIG = {
  version: "calendar-v2",
  /** How far ahead a window is searched, in calendar days from today in their zone. */
  windowDays: 14,
  /** Everyone's working hours in their own zone (the seed has no per person hours). */
  workday: { startMin: 9 * 60, endMin: 17 * 60 + 30 },
  /** Busy calendar kinds and how hard they are. Unknown busy kinds count as hard, the safe side. */
  level: { meeting: "hard", one_on_one: "hard", standup: "hard", interview: "hard", ooo: "hard", focus: "soft" } as Record<string, BlockLevel>,
  /** Whether focus time counts as available. Only a blocking, right now issue interrupts it. */
  softInterruptible: { blocked_now: true, blocked_today: false, curious: false } satisfies Record<AskUrgency, boolean>,
  /** "Inside the hour": a window opening within this many minutes makes a call or DM worth it. */
  withinHourMinutes: 60,
  /** What a quick synchronous ask requests. */
  quickAskMinutes: 10,
  /** Days with less than this left of the working day are skipped (nothing useful fits). */
  minDayRemainderMinutes: 15,
  stripDays: 7,
  stripSegmentMinutes: 30,
} as const;

const MIN = 60_000;
const DAY_MS = 86_400_000;

export type CalEvent = { start: number; end: number; kind: string; busy: boolean };
type Block = { start: number; end: number; level: BlockLevel; ooo: boolean };
type WorkDay = { date: string; dayStart: number; dayEnd: number; from: number };
type Span = { start: number; end: number };

export type HorizonStatus = "free" | "booked" | "ooo" | "unknown";

/** What ranking reads: the urgency horizon (1, 2 or 5 working days), scored 0..1. */
export type HorizonResult = {
  status: HorizonStatus;
  /** First gap of RANK_CONFIG.availability.minSlotMinutes inside the horizon. */
  nextFree: { start: Date; end: Date } | null;
  /** 0..1: blends how soon the first window opens with how much of the horizon is open; 0 when never free. */
  score: number;
  horizonEnd: Date | null;
  workingDays: number;
  oooDays: number;
  freeMinutes: number;
  workingMinutes: number;
};

export type EmployeeAvailability = {
  employeeId: string;
  tz: string;
  urgency: AskUrgency;
  minutes: number;
  /** Focus time counted as available for this urgency. */
  softAllowed: boolean;
  searched: { from: Date; to: Date; days: number; workingDays: number };
  /** Busy blocks that overlap their working hours in the searched window. */
  counts: { hard: number; soft: number };
  /** The next usable window in the 14 days, or null. end is where the open stretch ends. */
  window: { start: Date; end: Date; soft: boolean } | null;
  reason: string;
  horizon: HorizonResult;
};

export function classify(kind: string, busy: boolean): BlockLevel | "free" {
  if (!busy) return "free"; // office hours: open to drop ins
  return AVAILABILITY_CONFIG.level[kind] ?? "hard";
}

function toBlocks(events: CalEvent[]): Block[] {
  return events.flatMap((e): Block[] => {
    const level = classify(e.kind, e.busy);
    return level === "free" ? [] : [{ start: e.start, end: e.end, level, ooo: e.kind === "ooo" }];
  });
}

/** Working days in their zone from today, for `days` calendar days, skipping weekends and days already over. */
function workDays(tz: string, now: Date, days: number): WorkDay[] {
  const W = AVAILABILITY_CONFIG.workday;
  const today = localDate(now, tz);
  const out: WorkDay[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(today, d);
    const wd = weekday(date);
    if (wd === 0 || wd === 6) continue;
    const dayStart = localToUtc(date, W.startMin, tz).getTime();
    const dayEnd = localToUtc(date, W.endMin, tz).getTime();
    const from = Math.max(dayStart, now.getTime());
    if (dayEnd - from < AVAILABILITY_CONFIG.minDayRemainderMinutes * MIN) continue;
    out.push({ date, dayStart, dayEnd, from });
  }
  return out;
}

/** Open stretches of one working day: the day minus hard blocks, and minus soft blocks unless allowed. */
function openSpans(day: WorkDay, blocks: Block[], softAllowed: boolean): Span[] {
  const busy = blocks.filter((b) => b.end > day.from && b.start < day.dayEnd && (b.level === "hard" || !softAllowed)).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  let cursor = day.from;
  for (const b of busy) {
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, day.dayEnd) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < day.dayEnd) out.push({ start: cursor, end: day.dayEnd });
  return out;
}

const isOooDay = (day: WorkDay, blocks: Block[]) => blocks.some((b) => b.ooo && b.start <= day.from && b.end >= day.dayEnd);

/**
 * The whole answer for one person and one urgency. Pure: events, their zone, now.
 * `minutes` is the window length searched (defaults to the urgency's minimum slot in RANK_CONFIG).
 */
export function analyze(employeeId: string, events: CalEvent[], tz: string, now: Date, urgency: AskUrgency, minutes: number = RANK_CONFIG.availability.minSlotMinutes[urgency]): EmployeeAvailability {
  const A = AVAILABILITY_CONFIG;
  const R = RANK_CONFIG.availability;
  const softAllowed = A.softInterruptible[urgency];
  const blocks = toBlocks(events);
  const days = workDays(tz, now, A.windowDays);
  const minMs = minutes * MIN;
  const horizonMinMs = R.minSlotMinutes[urgency] * MIN;
  const horizonDays = R.horizonWorkingDays[urgency];

  let hard = 0;
  let soft = 0;
  let window: EmployeeAvailability["window"] = null;
  let windowDay: WorkDay | null = null;
  let oooBefore = 0;
  let softPassedOver = false;
  // horizon (for ranking)
  let counted = 0;
  let oooDays = 0;
  let workingMs = 0;
  let freeMs = 0;
  let before = 0;
  let nextFree: HorizonResult["nextFree"] = null;
  let horizonEnd: Date | null = null;

  for (const day of days) {
    const dayBlocks = blocks.filter((b) => b.end > day.from && b.start < day.dayEnd);
    for (const b of dayBlocks) {
      if (b.level === "hard") hard++;
      else soft++;
    }
    const ooo = isOooDay(day, dayBlocks);
    const spans = ooo ? [] : openSpans(day, dayBlocks, softAllowed);

    if (!window) {
      const hit = spans.find((s) => s.end - s.start >= minMs);
      if (hit) {
        window = { start: new Date(hit.start), end: new Date(hit.end), soft: dayBlocks.some((b) => b.level === "soft" && b.start < hit.start + minMs && b.end > hit.start) };
        windowDay = day;
        if (!softAllowed) softPassedOver = dayBlocks.some((b) => b.level === "soft" && b.start < hit.start && b.end > day.from);
      } else if (ooo) oooBefore++;
    }

    if (counted < horizonDays) {
      counted++;
      horizonEnd = new Date(day.dayEnd);
      const priorWork = workingMs;
      workingMs += day.dayEnd - day.from;
      if (ooo) oooDays++;
      for (const s of spans) {
        freeMs += s.end - s.start;
        if (!nextFree && s.end - s.start >= horizonMinMs) {
          nextFree = { start: new Date(s.start), end: new Date(s.end) };
          before = priorWork + (s.start - day.from);
        }
      }
    }
  }

  let horizon: HorizonResult;
  const base = { horizonEnd, workingDays: counted, oooDays, freeMinutes: Math.round(freeMs / MIN), workingMinutes: Math.round(workingMs / MIN) };
  if (counted === 0) horizon = { status: "unknown", nextFree: null, score: R.unknown, horizonEnd, workingDays: 0, oooDays: 0, freeMinutes: 0, workingMinutes: 0 };
  else if (oooDays === counted) horizon = { status: "ooo", nextFree: null, score: 0, ...base };
  else if (!nextFree) horizon = { status: "booked", nextFree: null, score: 0, ...base };
  else {
    const soon = 1 - (workingMs > 0 ? Math.min(1, before / workingMs) : 0);
    const open = workingMs > 0 ? Math.min(1, freeMs / workingMs / R.openShareFull) : 0;
    const score = R.soonShare * soon + (1 - R.soonShare) * open;
    horizon = { status: "free", nextFree, score: Math.max(R.floorWhenFree, Math.round(score * 1000) / 1000), ...base };
  }

  const to = new Date(localToUtc(addDays(localDate(now, tz), A.windowDays - 1), A.workday.endMin, tz).getTime());
  const reason = windowReason({ window, windowDay, now, tz, minutes, softAllowed, softPassedOver, oooBefore, days: days.length, hasEvents: events.length > 0, allOoo: days.length > 0 && days.every((d) => isOooDay(d, blocks)) });
  return { employeeId, tz, urgency, minutes, softAllowed, searched: { from: now, to, days: A.windowDays, workingDays: days.length }, counts: { hard, soft }, window, reason, horizon };
}

function windowReason(x: {
  window: EmployeeAvailability["window"];
  windowDay: WorkDay | null;
  now: Date;
  tz: string;
  minutes: number;
  softAllowed: boolean;
  softPassedOver: boolean;
  oooBefore: number;
  days: number;
  hasEvents: boolean;
  allOoo: boolean;
}): string {
  const N = AVAILABILITY_CONFIG.windowDays;
  if (!x.window || !x.windowDay) {
    if (x.days === 0) return `no working hours left in the next ${N} days`;
    if (x.allOoo) return `out of office for the whole ${N} day window`;
    return `no ${x.minutes} free minutes in their working hours in the next ${N} days${x.softAllowed ? "" : ", even before counting focus time as busy"}`;
  }
  const w = x.window;
  const startsNow = w.start.getTime() <= x.now.getTime() + MIN;
  const today = localDate(w.start, x.tz) === localDate(x.now, x.tz);
  const parts: string[] = [];
  if (startsNow) parts.push(w.soft ? "in focus time right now, which you may interrupt because you are blocked right now" : "free right now");
  else if (x.oooBefore) parts.push(`out of office until ${formatDay(x.windowDay.date)}, first open time after that`);
  else if (today) parts.push(`next ${x.minutes} free minutes today, after what is already booked`);
  else parts.push(`nothing open ${localDate(x.now, x.tz) === x.windowDay.date ? "sooner" : "for the rest of today"} in their working hours, so the first open time is ${formatDay(x.windowDay.date)}`);
  if (!startsNow && w.soft) parts.push("it starts in focus time, which you may interrupt because you are blocked right now");
  if (x.softPassedOver) parts.push("focus time before that is left alone for an ask that can wait");
  if (!x.hasEvents) parts.push("no calendar events on record, so all working hours count as free");
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

const zone = (tz: string) => ZONE_LABEL[tz] ?? tz;

/**
 * "today, 10:20 Pacific (18:20 their time, London)": the asker's zone first, theirs in parentheses.
 * A window open right now reads "now, 10:20 Pacific (...)".
 */
export function windowLabel(at: Date, askerTz: string, personTz: string, now: Date): string {
  const myDate = localDate(at, askerTz);
  const day = at.getTime() <= now.getTime() + MIN ? "now" : myDate === localDate(now, askerTz) ? "today" : formatDay(myDate);
  const theirDate = localDate(at, personTz);
  const theirs = `${theirDate !== myDate ? `${formatDay(theirDate)}, ` : ""}${localTime(at, personTz)} their time${personTz !== askerTz ? `, ${zone(personTz)}` : ""}`;
  return `${day}, ${localTime(at, askerTz)} ${zone(askerTz)} (${theirs})`;
}

/** "Mon, Oct 19, 10:00 Pacific" in one zone. */
export function slotLabel(at: Date, tz: string): string {
  return `${formatDay(localDate(at, tz))}, ${localTime(at, tz)} ${zone(tz)}`;
}

export function horizonLabel(urgency: AskUrgency): string {
  const n = RANK_CONFIG.availability.horizonWorkingDays[urgency];
  return n === 1 ? "the next working day" : `the next ${n} working days`;
}

function insideWorkingHours(at: Date, tz: string): boolean {
  const W = AVAILABILITY_CONFIG.workday;
  const wd = weekday(localDate(at, tz));
  const [h, m] = localTime(at, tz).split(":").map(Number);
  const min = h * 60 + m;
  return wd !== 0 && wd !== 6 && min >= W.startMin && min < W.endMin;
}

export function toWindowView(a: EmployeeAvailability, askerTz: string, now: Date): WindowView | null {
  if (!a.window) return null;
  const start = new Date(Math.max(a.window.start.getTime(), now.getTime()));
  return {
    start: start.toISOString(),
    end: a.window.end.toISOString(),
    label: windowLabel(start, askerTz, a.tz, now),
    minutesAway: Math.max(0, Math.round((start.getTime() - now.getTime()) / MIN)),
    soft: a.window.soft,
    outsideAskerHours: !insideWorkingHours(start, askerTz),
  };
}

// ---------------------------------------------------------------------------
// the channel recommendation
// ---------------------------------------------------------------------------

export type PreferredChannel = "slack" | "email" | "call";

export type RecommendInput = {
  urgency: AskUrgency;
  preferred: PreferredChannel;
  person: { id: string; name: string; window: WindowView | null };
  /**
   * Other owners of the asked services who could take it instead: not the person, not excluded by
   * a guardrail (weekly limit, out of office). Secondary owners first.
   */
  otherOwners: Array<{ id: string; name: string; role: "primary" | "secondary"; serviceName: string; window: WindowView | null }>;
};

const firstOf = (name: string) => name.split(" ")[0] ?? name;
/** "now, 10:20 Pacific (...)" or "in 25 minutes (today, 10:45 Pacific (...))". */
const freeAt = (w: WindowView) => (w.minutesAway === 0 ? w.label : `in ${w.minutesAway} minutes (${w.label})`);

/**
 * The app's default is to not interrupt anyone. Only someone blocked right now, with a person free
 * inside the hour, gets a call or DM suggestion; everything else is an async message, and the
 * reason says plainly that it does not take their time.
 */
export function recommendChannel(i: RecommendInput): Recommendation {
  const A = AVAILABILITY_CONFIG;
  const first = firstOf(i.person.name);
  const w = i.person.window;
  // Plain boolean, not a type guard: a guard would narrow `w` to null after the first branch.
  const within = (x: WindowView | null): boolean => !!x && x.minutesAway <= A.withinHourMinutes;
  const message = i.preferred === "email" ? "email" : "Slack message";
  const rec = (rule: ChannelRule, channel: Recommendation["channel"], target: { id: string; name: string }, headline: string, reason: string): Recommendation => ({ rule, channel, targetId: target.id, targetName: target.name, headline, reason });

  if (i.urgency === "blocked_now") {
    if (w && within(w)) {
      const call = i.preferred === "call";
      return rec(
        "blocked_now_free_within_hour",
        call ? "call" : "dm",
        i.person,
        call ? `Ask ${first} for a short call` : `DM ${first} asking for ${A.quickAskMinutes} minutes`,
        `You are blocked right now and ${first} is free ${freeAt(w)}, so ${call ? `a ${A.quickAskMinutes} minute call` : `a short DM asking for ${A.quickAskMinutes} minutes`} gets you unblocked without a long wait.${w.soft ? ` That time is focus time: interrupting it is fair only because you are blocked, so keep it to ${A.quickAskMinutes} minutes.` : ""}`,
      );
    }
    const alt = [...i.otherOwners].filter((o) => o.id !== i.person.id && within(o.window)).sort((a, b) => (a.role === b.role ? a.window!.minutesAway - b.window!.minutesAway : a.role === "secondary" ? -1 : 1))[0];
    const later = w ? `next open ${w.label}` : `no open time in the next ${A.windowDays} days`;
    if (alt) {
      const af = firstOf(alt.name);
      return rec(
        "blocked_now_other_owner",
        "dm",
        alt,
        `DM ${af} instead`,
        `${first} has nothing open in the next hour (${later}). ${af} is the ${alt.role} owner of ${alt.serviceName} and is free ${freeAt(alt.window!)}, so ask ${af} and you are not left waiting.`,
      );
    }
    return rec(
      "blocked_now_no_slot",
      "async",
      i.person,
      `Send ${first} a ${message} now, no call`,
      `${first} has nothing open in the next hour (${later})${i.otherOwners.some((o) => o.id !== i.person.id) ? ", and no other owner is free sooner" : ""}. Send it now and say you are blocked: it is waiting when ${first} is free, without pulling them out of a meeting.`,
    );
  }
  if (i.urgency === "blocked_today") {
    return rec(
      "blocked_today_async",
      "async",
      i.person,
      `Send ${first} an async ${message}`,
      `You can wait a few hours, so an async message is enough. It does not take ${first}'s time until they choose to read it${w ? `, and their next open time is ${w.label}` : ""}.`,
    );
  }
  return rec(
    "curious_async",
    "async",
    i.person,
    `Send ${first} an async ${message}`,
    `You are not blocked, so an async message is the right ask: it does not take any of ${first}'s time until they choose to answer, and nobody is interrupted.${w ? ` If you want to talk it through later, their next open time is ${w.label}.` : ""}`,
  );
}

/** The one line per person per availability query. */
export function logAvailability(label: string, a: EmployeeAvailability, view: WindowView | null, rec: Recommendation | null): void {
  const searched = `${a.searched.from.toISOString().slice(0, 16)}Z to ${a.searched.to.toISOString().slice(0, 10)} (${a.searched.days} days, ${a.searched.workingDays} working days, ${zone(a.tz)})`;
  const slot = view ? `${view.label} for ${Math.round((Date.parse(view.end) - Date.parse(view.start)) / MIN)} min${view.soft ? ", in focus time" : ""}` : "none";
  log.info(
    `${label} availability ${a.employeeId} searched ${searched} hard=${a.counts.hard} soft=${a.counts.soft} urgency=${a.urgency} focus_time=${a.softAllowed ? "interruptible" : "busy"} slot=${slot}; ${rec ? `channel=${rec.channel} rule=${rec.rule}${rec.targetId !== a.employeeId ? ` target=${rec.targetId}` : ""}` : "no recommendation"} (${a.reason})`,
    { employeeId: a.employeeId, horizon: a.horizon.status, score: a.horizon.score },
  );
}

// ---------------------------------------------------------------------------
// the week strip
// ---------------------------------------------------------------------------

export function weekStrip(employeeId: string, events: CalEvent[], tz: string, now: Date): WeekStripData {
  const A = AVAILABILITY_CONFIG;
  const W = A.workday;
  const segMs = A.stripSegmentMinutes * MIN;
  const n = Math.round((W.endMin - W.startMin) / A.stripSegmentMinutes);
  const blocks = toBlocks(events);
  const today = localDate(now, tz);
  const days: StripDay[] = [];
  for (let i = 0; i < A.stripDays; i++) {
    const date = addDays(today, i);
    const wd = weekday(date);
    const [weekdayShort] = formatDay(date).split(",");
    const weekend = wd === 0 || wd === 6;
    const dayStart = localToUtc(date, W.startMin, tz).getTime();
    const dayEnd = localToUtc(date, W.endMin, tz).getTime();
    const dayBlocks = blocks.filter((b) => b.end > dayStart && b.start < dayEnd);
    const ooo = !weekend && dayBlocks.some((b) => b.ooo && b.start <= dayStart && b.end >= dayEnd);
    const segments: StripSegment[] = [];
    let hardMs = 0;
    let softMs = 0;
    let pastSegments = 0;
    for (let k = 0; k < n && !weekend && !ooo; k++) {
      const s = dayStart + k * segMs;
      const e = s + segMs;
      const overlap = (lvl: BlockLevel) => dayBlocks.filter((b) => b.level === lvl).reduce((sum, b) => sum + Math.max(0, Math.min(e, b.end) - Math.max(s, b.start)), 0);
      const h = Math.min(segMs, overlap("hard"));
      const sf = Math.min(segMs - h, overlap("soft"));
      hardMs += h;
      softMs += sf;
      segments.push(h * 2 >= segMs ? "hard" : (h + sf) * 2 >= segMs ? (h >= sf ? "hard" : "soft") : "free");
      if (i === 0 && e <= now.getTime()) pastSegments++;
    }
    const total = weekend || ooo ? 0 : (dayEnd - dayStart) / MIN;
    days.push({
      date,
      weekdayShort,
      dayOfMonth: String(Number(date.slice(8))),
      today: i === 0,
      weekend,
      ooo,
      segments,
      pastSegments,
      hardMinutes: Math.round(hardMs / MIN),
      softMinutes: Math.round(softMs / MIN),
      freeMinutes: Math.max(0, Math.round(total - (hardMs + softMs) / MIN)),
    });
  }
  return { employeeId, tz, zoneLabel: zone(tz), startMin: W.startMin, endMin: W.endMin, segmentMinutes: A.stripSegmentMinutes, days };
}

// ---------------------------------------------------------------------------
// time zones and load
// ---------------------------------------------------------------------------

/** Shared working hours of two zones on the day of `at`, in hours. */
export function overlapHoursBetween(tzA: string, tzB: string, at: Date): number {
  const W = AVAILABILITY_CONFIG.workday;
  const offA = tzOffsetMinutes(tzA, at.getTime());
  const offB = tzOffsetMinutes(tzB, at.getTime());
  return Math.max(0, Math.min(W.endMin - offA, W.endMin - offB) - Math.max(W.startMin - offA, W.startMin - offB)) / 60;
}

export async function overlapHours(askerId: string, employeeId: string, now: Date): Promise<number> {
  const zones = await loadZones([askerId, employeeId]);
  const a = zones.get(askerId);
  const b = zones.get(employeeId);
  if (!a || !b) {
    log.warn(`overlap ${askerId} and ${employeeId}: no time zone for ${!a ? askerId : employeeId}, answering 0`);
    return 0;
  }
  const h = overlapHoursBetween(a, b, now);
  log.debug(`overlap ${askerId} (${zone(a)}) and ${employeeId} (${zone(b)}): ${h} working hours`);
  return h;
}

/**
 * Who a `sent` transition went to: the recipient written on the event by "I sent this"
 * (src/lib/ask-outcome.ts), else the ask's routed_to_id (seeded history). Per event, so an ask
 * rerouted to the next person on the shortlist counts once for each person it was really sent to.
 */
const sentTo = sql<string | null>`coalesce(${t.askEvents.data}->>'recipientId', ${t.asks.routedToId})`;

/**
 * Asks sent to each person in the last LOAD_WINDOW_DAYS rolling days: the `sent` transitions
 * (ask_events) addressed to them inside the window. No upper bound, so an ask sent after a pinned
 * demo clock still counts. Ranking's load penalty and hard cap read this.
 */
export async function loadsThisWeek(ids: string[], now: Date): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const since = new Date(now.getTime() - LOAD_WINDOW_DAYS * DAY_MS);
  const rows = await q("availability.load", (db) =>
    db
      .select({ id: sentTo, n: sql<number>`count(distinct ${t.asks.id})::int` })
      .from(t.askEvents)
      .innerJoin(t.asks, eq(t.asks.id, t.askEvents.askId))
      .where(and(eq(t.askEvents.toState, "sent"), gte(t.askEvents.at, since), inArray(sentTo, ids)))
      .groupBy(sentTo),
  );
  return new Map(rows.filter((r) => r.id).map((r) => [r.id!, r.n]));
}

export async function loadThisWeek(employeeId: string, now: Date): Promise<number> {
  return (await loadsThisWeek([employeeId], now)).get(employeeId) ?? 0;
}

/** employees.id, always table-qualified: in a one-table select Drizzle renders the column as a bare "id", which is ambiguous inside a correlated subquery. */
export const EMPLOYEE_ID_SQL = sql`${sql.identifier("employees")}.${sql.identifier("id")}`;

/** The same rule as loadsThisWeek, as a correlated subquery on employees for lists (directory sort by load). */
export function loadSqlFor(now: Date) {
  const since = new Date(now.getTime() - LOAD_WINDOW_DAYS * DAY_MS).toISOString();
  return sql<number>`(select count(distinct a.id)::int from ${t.askEvents} e join ${t.asks} a on a.id = e.ask_id where coalesce(e.data->>'recipientId', a.routed_to_id) = ${EMPLOYEE_ID_SQL} and e.to_state = 'sent' and e.at >= ${since}::timestamptz)`;
}

// ---------------------------------------------------------------------------
// loaders
// ---------------------------------------------------------------------------

async function loadZones(ids: string[]): Promise<Map<string, string>> {
  const rows = await q("availability.zones", (db) => db.select({ id: t.employees.id, tz: t.employees.timezone }).from(t.employees).where(inArray(t.employees.id, ids)));
  return new Map(rows.map((r) => [r.id, r.tz]));
}

async function loadEvents(ids: string[], from: Date, to: Date): Promise<Map<string, CalEvent[]>> {
  const out = new Map<string, CalEvent[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = await q("availability.events", (db) =>
    db
      .select({ employeeId: t.calendarEvents.employeeId, startsAt: t.calendarEvents.startsAt, endsAt: t.calendarEvents.endsAt, busy: t.calendarEvents.busy, kind: t.calendarEvents.kind })
      .from(t.calendarEvents)
      .where(and(inArray(t.calendarEvents.employeeId, ids), lt(t.calendarEvents.startsAt, to), gte(t.calendarEvents.endsAt, from))),
  );
  for (const r of rows) out.get(r.employeeId)?.push({ start: r.startsAt.getTime(), end: r.endsAt.getTime(), kind: r.kind, busy: r.busy });
  return out;
}

/** Window bounds wide enough for every zone: a day before now to the window's end plus a day. */
const bounds = (now: Date, days: number) => ({ from: new Date(now.getTime() - DAY_MS), to: new Date(now.getTime() + (days + 1) * DAY_MS) });

export type AvailabilityRequest = { label: string; employees: Array<{ id: string; timezone: string }>; urgency: AskUrgency; now: Date };

export interface AvailabilityProvider {
  name: string;
  check(req: AvailabilityRequest): Promise<Map<string, EmployeeAvailability>>;
}

/** Free/busy from calendar_events: one query for everyone, then analyze() per person. */
export const calendarAvailability: AvailabilityProvider = {
  name: AVAILABILITY_CONFIG.version,
  async check({ label, employees, urgency, now }) {
    const out = new Map<string, EmployeeAvailability>();
    if (!employees.length) return out;
    const { from, to } = bounds(now, AVAILABILITY_CONFIG.windowDays);
    const events = await loadEvents(
      employees.map((e) => e.id),
      from,
      to,
    );
    const empty = employees.filter((e) => !events.get(e.id)?.length).map((e) => e.id);
    if (empty.length) log.skip(`${label} calendar for ${empty.join(", ")}`, `no calendar events between ${from.toISOString().slice(0, 10)} and ${to.toISOString().slice(0, 10)} (seed calendars cover 14 days from the load day); all their working hours count as free`);
    for (const e of employees) out.set(e.id, analyze(e.id, events.get(e.id) ?? [], e.timezone, now, urgency));
    log.debug(`${label} availability checked for ${employees.length} people via ${AVAILABILITY_CONFIG.version}, urgency ${urgency}, focus time ${AVAILABILITY_CONFIG.softInterruptible[urgency] ? "interruptible" : "busy"}`);
    return out;
  },
};

/** One person's next usable window for `minutes` at this urgency, with the reason. Not logged: callers log with the recommendation. */
export async function nextWindow(employeeId: string, minutes: number, urgency: AskUrgency, now: Date): Promise<{ slot: { start: Date; end: Date; soft: boolean } | null; reason: string; availability: EmployeeAvailability } | null> {
  const zones = await loadZones([employeeId]);
  const tz = zones.get(employeeId);
  if (!tz) {
    log.warn(`next window for ${employeeId}: no such employee`);
    return null;
  }
  const { from, to } = bounds(now, AVAILABILITY_CONFIG.windowDays);
  const events = (await loadEvents([employeeId], from, to)).get(employeeId) ?? [];
  const a = analyze(employeeId, events, tz, now, urgency, minutes);
  return { slot: a.window, reason: a.reason, availability: a };
}

/** Week strips for a set of people, one events query. */
export async function loadWeekStrips(label: string, ids: string[], now: Date): Promise<Map<string, WeekStripData>> {
  const out = new Map<string, WeekStripData>();
  if (!ids.length) return out;
  const [zones, events] = await Promise.all([loadZones(ids), loadEvents(ids, new Date(now.getTime() - DAY_MS), new Date(now.getTime() + (AVAILABILITY_CONFIG.stripDays + 1) * DAY_MS))]);
  for (const id of ids) {
    const tz = zones.get(id);
    if (!tz) continue;
    out.set(id, weekStrip(id, events.get(id) ?? [], tz, now));
  }
  log.debug(`${label} week strips for ${out.size} people from ${now.toISOString().slice(0, 16)}Z`, {
    busiest: [...out.values()].map((s) => `${s.employeeId}:${s.days.reduce((n, d) => n + d.hardMinutes, 0)}`).join(" "),
  });
  return out;
}

// ---------------------------------------------------------------------------
// one colleague, for /directory/[personId]
// ---------------------------------------------------------------------------

export type PersonUrgencyView = { urgency: AskUrgency; window: WindowView | null; reason: string; counts: { hard: number; soft: number }; recommendation: Recommendation };

export type PersonAvailability = { strip: WeekStripData | null; askerTz: string; personTz: string; overlapHours: number; byUrgency: PersonUrgencyView[] };

/**
 * Everything the person page shows: the strip, and for each urgency the next window and the
 * channel the viewer would be advised to use, with the other owners of their services as the
 * alternative (never one at their weekly limit or out of office). One availability line per urgency.
 */
export async function availabilityForPerson(label: string, employeeId: string, askerId: string | null, preferred: PreferredChannel, now: Date): Promise<PersonAvailability | null> {
  const services = await q("availability.person.services", (db) =>
    db
      .select({ id: t.services.id, name: t.services.name, primary: t.services.primaryOwnerId, secondary: t.services.secondaryOwnerId })
      .from(t.services)
      .where(sql`${t.services.primaryOwnerId} = ${employeeId} or ${t.services.secondaryOwnerId} = ${employeeId}`),
  );
  const otherIds = [...new Set(services.flatMap((s) => [s.primary, s.secondary]))].filter((id) => id !== employeeId);
  const peopleIds = [...new Set([employeeId, ...otherIds, ...(askerId ? [askerId] : [])])];
  const { from, to } = bounds(now, AVAILABILITY_CONFIG.windowDays);
  const [people, events, loads] = await Promise.all([
    q("availability.person.people", (db) => db.select({ id: t.employees.id, name: t.employees.name, tz: t.employees.timezone, max: t.employees.maxWeeklyAsks }).from(t.employees).where(inArray(t.employees.id, peopleIds))),
    loadEvents([employeeId, ...otherIds], from, to),
    loadsThisWeek(otherIds, now),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const me = byId.get(employeeId);
  if (!me) {
    log.warn(`${label} availability for ${employeeId}: no such employee`);
    return null;
  }
  const askerTz = (askerId && byId.get(askerId)?.tz) || "America/Los_Angeles";
  if (!askerId) log.skip(`${label} asker zone`, "no persona for this viewer, so times are shown in Pacific");
  const mine = events.get(employeeId) ?? [];
  if (!mine.length) log.skip(`${label} calendar for ${employeeId}`, "no calendar events in the window; all working hours count as free");

  const byUrgency: PersonUrgencyView[] = (["blocked_now", "blocked_today", "curious"] as const).map((urgency) => {
    const a = analyze(employeeId, mine, me.tz, now, urgency);
    const view = toWindowView(a, askerTz, now);
    const otherOwners = services.flatMap((s) => {
      const id = s.primary === employeeId ? s.secondary : s.primary;
      const o = byId.get(id);
      if (!o || id === employeeId) return [];
      const oa = analyze(id, events.get(id) ?? [], o.tz, now, urgency);
      const blockedBy = (loads.get(id) ?? 0) >= o.max ? "at their weekly limit" : oa.horizon.status === "ooo" ? "out of office" : null;
      if (blockedBy) {
        log.branch(`${label} ${id} not offered as the other owner of ${s.name} (${urgency})`, blockedBy);
        return [];
      }
      return [{ id, name: o.name, role: (s.primary === employeeId ? "secondary" : "primary") as "primary" | "secondary", serviceName: s.name, window: toWindowView(oa, askerTz, now) }];
    });
    const recommendation = recommendChannel({ urgency, preferred, person: { id: employeeId, name: me.name, window: view }, otherOwners });
    logAvailability(label, a, view, recommendation);
    return { urgency, window: view, reason: a.reason, counts: a.counts, recommendation };
  });

  return { strip: weekStrip(employeeId, mine, me.tz, now), askerTz, personTz: me.tz, overlapHours: overlapHoursBetween(askerTz, me.tz, now), byUrgency };
}
