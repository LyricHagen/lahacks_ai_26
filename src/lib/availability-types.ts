// Client-safe shapes for availability: the stored next window, the channel recommendation and the
// week strip. The engine that fills them is src/lib/availability.ts (server only).

export type BlockLevel = "hard" | "soft";

/** Which urgency rule produced the channel recommendation. Logged and stored with it. */
export type ChannelRule = "blocked_now_free_within_hour" | "blocked_now_other_owner" | "blocked_now_no_slot" | "blocked_today_async" | "curious_async";

/** call and dm interrupt someone; async waits until they choose to read it. */
export type RecommendedChannel = "call" | "dm" | "async";

export type Recommendation = {
  rule: ChannelRule;
  channel: RecommendedChannel;
  /** Who to contact: the person on the row, or the other owner when they are the better ask. */
  targetId: string;
  targetName: string;
  headline: string;
  reason: string;
};

export type WindowView = {
  start: string;
  end: string;
  /** In the asker's zone with the person's local time in parentheses. */
  label: string;
  /** Minutes from now until it opens (0 when it is open now). */
  minutesAway: number;
  /** The window starts inside focus time (only possible when the urgency allows interrupting it). */
  soft: boolean;
  /** Before or after the asker's own working hours. */
  outsideAskerHours: boolean;
};

export type StripSegment = "hard" | "soft" | "free";

export type StripDay = {
  date: string;
  /** "Mon" */
  weekdayShort: string;
  /** "19" */
  dayOfMonth: string;
  today: boolean;
  weekend: boolean;
  ooo: boolean;
  /** One per AVAILABILITY_CONFIG.stripSegmentMinutes of their working day, top to bottom. */
  segments: StripSegment[];
  /** Segments of today already in the past. */
  pastSegments: number;
  hardMinutes: number;
  softMinutes: number;
  freeMinutes: number;
};

export type WeekStripData = { employeeId: string; tz: string; zoneLabel: string; startMin: number; endMin: number; segmentMinutes: number; days: StripDay[] };

export const CHANNEL_WORD: Record<RecommendedChannel, string> = { call: "Short call", dm: "Direct message", async: "Async message" };

export const RULE_LABEL: Record<ChannelRule, string> = {
  blocked_now_free_within_hour: "blocked now, free within the hour",
  blocked_now_other_owner: "blocked now, the other owner is free sooner",
  blocked_now_no_slot: "blocked now, nobody free within the hour",
  blocked_today_async: "blocked today, can wait a few hours",
  curious_async: "not blocked",
};

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);

/** Spoken summary of one strip column, for screen readers and the title tooltip. */
export function stripDayText(d: StripDay): string {
  const day = `${d.weekdayShort} ${d.dayOfMonth}${d.today ? " (today)" : ""}`;
  if (d.weekend) return `${day}: weekend, not working`;
  if (d.ooo) return `${day}: out of office`;
  return `${day}: ${hm(d.hardMinutes)} in meetings, ${hm(d.softMinutes)} focus time, ${hm(d.freeMinutes)} free`;
}
