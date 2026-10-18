// THE clock. Nothing else in the codebase reads the system time: `pnpm check` fails on Date.now()
// or a bare new Date() anywhere but this file.
//
// Two kinds of time:
//
//   app time   "now" for anything about the synthetic company: calendars, availability, ask load,
//              tenure, recency of work. In demo mode it is PINNED to demoInstant(seed anchor day),
//              a fixed weekday morning inside the seeded calendar window, so a demo shows the same
//              free and busy times whenever it runs. Server code gets it from getClock()
//              (src/lib/clock-request.ts); scripts from demoClock() (src/lib/clock-server.ts); pure
//              code takes `now` as an argument and never reads a clock itself.
//   wall time  the real time, for infrastructure: log stamps, run leases, rate limits, budgets,
//              pacing, the 24 hour cooldown, and audit timestamps (when a row was really written).
//              wallNow() / wallMs().
//
// No imports beyond the time helpers: safe on the client, in scripts, everywhere.

import { addDays, formatDay, localDate, localTime, localToUtc, weekday, ZONE_LABEL } from "./time";

export type AppClock = {
  /** App time. Pinned in demo mode, the real time otherwise. */
  now: Date;
  pinned: boolean;
  /** Plain sentence for the log and the UI note. */
  reason: string;
  /** seed.anchor_day the pin was derived from (null when not pinned or not seeded). */
  anchorDay: string | null;
};

/** Real milliseconds since the epoch. Infrastructure only (leases, pacing, rate limits). */
export function wallMs(): number {
  return Date.now();
}

/** The real time. Infrastructure and audit timestamps only; anything about the company uses app time. */
export function wallNow(): Date {
  return new Date(Date.now());
}

/**
 * Where the demo clock is pinned: the first weekday on or after the seed's load day, at 10:20
 * Pacific. Late enough that Pacific engineers are in their morning focus block (so the focus time
 * rule shows), early enough that most of the day is ahead, and on the load day itself whenever it
 * is a weekday, so "asks this week" matches the seed summary exactly. London is already past its
 * working day at that moment, which is the realistic cross-zone case.
 */
export const DEMO_CLOCK = { zone: "America/Los_Angeles", minutesIntoDay: 10 * 60 + 20, maxShiftDays: 3 } as const;

export function demoInstant(anchorDay: string): Date {
  let day = anchorDay;
  for (let i = 0; i < DEMO_CLOCK.maxShiftDays && (weekday(day) === 0 || weekday(day) === 6); i++) day = addDays(day, 1);
  return localToUtc(day, DEMO_CLOCK.minutesIntoDay, DEMO_CLOCK.zone);
}

export function pinnedClock(anchorDay: string, reason: string): AppClock {
  return { now: demoInstant(anchorDay), pinned: true, reason, anchorDay };
}

export function systemClock(reason: string): AppClock {
  return { now: wallNow(), pinned: false, reason, anchorDay: null };
}

/** "Mon, Oct 19, 10:20 Pacific" for the demo clock note. */
export function clockLabel(at: Date, tz: string = DEMO_CLOCK.zone): string {
  return `${formatDay(localDate(at, tz))}, ${localTime(at, tz)} ${ZONE_LABEL[tz] ?? tz}`;
}
