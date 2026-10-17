// Calendars for the next 14 days, generated at load time from each person's calendar profile.
// Deterministic for a given seed string and load day. All times are laid out in the person's
// own timezone (working hours 9:00 to 17:30), then converted to UTC.

import { addDays, localToUtc, weekday } from "@/lib/time";
import type { Company, FxEmployee } from "./fixture";
import { createRng, type Rng } from "./rng";

export const CALENDAR_DAYS = 14;

export type CalendarRow = {
  employeeId: string;
  title: string;
  kind: "meeting" | "one_on_one" | "standup" | "focus" | "interview" | "office_hours" | "ooo";
  startsAt: Date;
  endsAt: Date;
  busy: boolean;
};

const MEETINGS = [
  "Sprint planning",
  "Design review",
  "Roadmap sync",
  "Cross-team sync",
  "Architecture review",
  "Incident review",
  "Team retro",
  "Product review",
  "Hiring debrief",
  "Quarterly planning",
  "Vendor call",
  "Launch readiness",
];
const CUSTOMER = ["Customer call", "Escalation review", "Onboarding call", "Account check-in", "Quarterly business review"];
const HEAVY = ["Code review: urgent change", "Help: unblock a teammate", "Escalation", "Ad hoc debugging", "Review a design doc", "Pairing"];

type Slot = { start: number; end: number };

/** One working day's layout. Minutes from local midnight. */
class Day {
  slots: Slot[] = [];
  constructor(
    readonly rows: CalendarRow[],
    readonly e: FxEmployee,
    readonly date: string,
  ) {}
  free(start: number, end: number): boolean {
    return this.slots.every((s) => end <= s.start || start >= s.end);
  }
  add(start: number, end: number, title: string, kind: CalendarRow["kind"], busy = true): boolean {
    if (!this.free(start, end)) return false;
    this.slots.push({ start, end });
    this.rows.push({ employeeId: this.e.id, title, kind, startsAt: localToUtc(this.date, start, this.e.timezone), endsAt: localToUtc(this.date, end, this.e.timezone), busy });
    return true;
  }
  /** Try a few random starts on a half hour grid inside [from, to). */
  place(rng: Rng, from: number, to: number, len: number, title: string, kind: CalendarRow["kind"]): boolean {
    for (let i = 0; i < 6; i++) {
      const start = from + 30 * rng.int(0, Math.max(0, Math.floor((to - from - len) / 30)));
      if (this.add(start, start + len, title, kind)) return true;
    }
    return false;
  }
}

const H = (h: number, m = 0) => h * 60 + m;

export function generateCalendars(c: Company, anchorIso: string): CalendarRow[] {
  const rows: CalendarRow[] = [];
  const reports = new Map<string, FxEmployee[]>();
  for (const e of c.employees) if (e.managerId) reports.set(e.managerId, [...(reports.get(e.managerId) ?? []), e]);

  for (const e of c.employees) {
    const rng = createRng(`${c.seed}::calendar::${e.id}::${anchorIso}`);
    const cal = e.calendar;
    const first = (id: string) => c.employees.find((x) => x.id === id)?.name.split(" ")[0] ?? "teammate";

    for (let d = 0; d < CALENDAR_DAYS; d++) {
      const date = addDays(anchorIso, d);
      const wd = weekday(date);
      if (wd === 0 || wd === 6) continue;
      const day = new Day(rows, e, date);

      if (cal.ooo && d >= cal.ooo.from && d <= cal.ooo.to) {
        day.add(0, H(24), cal.ooo.title, "ooo");
        continue;
      }
      if (cal.fullyBookedDays && d < cal.fullyBookedDays) {
        let t = H(8, 30);
        while (t < H(18)) {
          const len = rng.pick([30, 60, 60, 90]);
          day.add(t, Math.min(H(18), t + len), rng.pick([...MEETINGS, ...HEAVY]), "meeting");
          t += len;
        }
        continue;
      }

      switch (cal.archetype) {
        case "exec": {
          // Mornings are back to back; afternoons have a few gaps.
          for (let t = H(8, 30); t < H(12, 30); t += 30) if (rng.chance(0.85)) day.add(t, t + 30, rng.pick(MEETINGS), "meeting");
          for (const r of rng.sample(reports.get(e.id) ?? [], 2)) day.place(rng, H(13), H(17), 30, `1:1 with ${first(r.id)}`, "one_on_one");
          for (let i = 0; i < 2; i++) day.place(rng, H(13), H(17, 30), 60, rng.pick(MEETINGS), "meeting");
          break;
        }
        case "manager": {
          day.add(H(9), H(9, 15), "Team standup", "standup");
          for (let t = H(9, 30); t < H(12); t += 30) if (rng.chance(0.7)) day.add(t, t + 30, rng.pick(MEETINGS), "meeting");
          const mine = reports.get(e.id) ?? [];
          // Each report gets one 1:1 a week; spread them over the week.
          for (const r of mine.filter((_, i) => i % 5 === (wd - 1))) day.place(rng, H(13), H(17), 30, `1:1 with ${first(r.id)}`, "one_on_one");
          if (rng.chance(0.4)) day.place(rng, H(14), H(17), 60, "Interview", "interview");
          break;
        }
        case "engineer": {
          day.add(H(9, 30), H(9, 45), "Team standup", "standup");
          if (rng.chance(0.75)) day.add(H(10), H(12), "Focus time", "focus");
          if (rng.chance(0.5)) day.add(H(13, 30), H(16), "Focus time", "focus");
          for (let i = 0, n = rng.int(0, 2); i < n; i++) day.place(rng, H(10), H(17, 30), rng.pick([30, 60]), rng.pick(MEETINGS), "meeting");
          if (e.seniority !== "junior" && e.seniority !== "mid" && rng.chance(0.15)) day.place(rng, H(13), H(17), 60, "Interview", "interview");
          break;
        }
        case "support": {
          day.add(H(9), H(9, 15), "Queue review", "standup");
          for (let i = 0, n = rng.int(2, 4); i < n; i++) day.place(rng, H(9, 30), H(17, 30), rng.pick([30, 45, 60]), rng.pick(CUSTOMER), "meeting");
          if (rng.chance(0.4)) day.place(rng, H(10), H(16), 90, "Focus time", "focus");
          break;
        }
        case "designer": {
          if (rng.chance(0.6)) day.add(H(10), H(12), "Focus time", "focus");
          for (let i = 0, n = rng.int(1, 2); i < n; i++) day.place(rng, H(13), H(17), 60, rng.pick(["Design critique", "Research session", "Product review"]), "meeting");
          break;
        }
        case "business": {
          for (let i = 0, n = rng.int(1, 3); i < n; i++) day.place(rng, H(9, 30), H(17), rng.pick([30, 60]), rng.pick(MEETINGS), "meeting");
          if (rng.chance(0.4)) day.place(rng, H(13), H(16), 120, "Focus time", "focus");
          break;
        }
      }

      if (cal.heavy) {
        // Named in everything: extra reviews and interruptions fill most of the gaps.
        for (let i = 0, n = rng.int(3, 5); i < n; i++) day.place(rng, H(9), H(17, 30), rng.pick([30, 60]), rng.pick(HEAVY), "meeting");
      }
      if (cal.officeHours && cal.officeHours.weekday === wd) {
        day.add(cal.officeHours.startMin, cal.officeHours.startMin + 60, "Office hours (drop in)", "office_hours", false);
      }
    }
  }
  return rows;
}
