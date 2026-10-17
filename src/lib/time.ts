// Timezone helpers with no dependencies (Intl only). Shared by the seed and the UI.

export const ZONES = ["America/Los_Angeles", "America/New_York", "Europe/London"] as const;
export type Zone = (typeof ZONES)[number];

export const ZONE_LABEL: Record<string, string> = {
  "America/Los_Angeles": "Pacific",
  "America/New_York": "Eastern",
  "Europe/London": "London",
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Minutes the zone is ahead of UTC at the given instant (negative for the Americas). */
export function tzOffsetMinutes(tz: string, utcMs: number): number {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** A wall-clock time in a zone ("2026-10-19", 9:30 in New York) as a UTC Date. */
export function localToUtc(isoDate: string, minutesIntoDay: number, tz: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutesIntoDay);
  const off = tzOffsetMinutes(tz, guess);
  let t = guess - off * 60000;
  const off2 = tzOffsetMinutes(tz, t);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

/** "YYYY-MM-DD" for a UTC date plus n days. */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** 0 is Sunday. Calendar dates have the same weekday everywhere. */
export function weekday(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The calendar date ("YYYY-MM-DD") of an instant as seen in a zone. */
export function localDate(at: Date, tz: string): string {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** "09:30" in the zone. */
export function localTime(at: Date, tz: string): string {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
