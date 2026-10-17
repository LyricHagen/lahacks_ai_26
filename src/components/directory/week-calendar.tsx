import { addDays, formatDay, localDate, localTime, weekday, ZONE_LABEL } from "@/lib/time";
import { Badge } from "../ui/badge";

type Event = { id: number; title: string; kind: string; startsAt: Date; endsAt: Date; busy: boolean };

const KIND_LABEL: Record<string, string> = {
  meeting: "Meeting",
  one_on_one: "1:1",
  standup: "Standup",
  focus: "Focus",
  interview: "Interview",
  office_hours: "Office hours",
  ooo: "Out of office",
};

const DAY_START = 9 * 60;
const DAY_END = 17 * 60 + 30;
const MIN_GAP = 30;

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export type DayPlan = {
  date: string;
  weekend: boolean;
  ooo: string | null;
  events: Event[];
  open: { start: number; end: number }[];
};

/** Group a person's events by their local day and find open windows inside working hours. */
export function planWeek(events: Event[], tz: string, now = new Date()): DayPlan[] {
  const today = localDate(now, tz);
  const nowMin = toMin(localTime(now, tz));
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const wd = weekday(date);
    const dayEvents = events.filter((e) => localDate(e.startsAt, tz) === date);
    const ooo = dayEvents.find((e) => e.kind === "ooo");
    const weekend = wd === 0 || wd === 6;
    const open: DayPlan["open"] = [];
    if (!weekend && !ooo) {
      const busy = dayEvents
        .filter((e) => e.busy)
        .map((e) => ({ start: toMin(localTime(e.startsAt, tz)), end: localDate(e.endsAt, tz) === date ? toMin(localTime(e.endsAt, tz)) : 24 * 60 }))
        .sort((a, b) => a.start - b.start);
      let cursor = i === 0 ? Math.max(DAY_START, Math.ceil(nowMin / 15) * 15) : DAY_START;
      for (const b of busy) {
        if (b.start - cursor >= MIN_GAP && cursor < DAY_END) open.push({ start: cursor, end: Math.min(b.start, DAY_END) });
        cursor = Math.max(cursor, b.end);
      }
      if (DAY_END - cursor >= MIN_GAP) open.push({ start: cursor, end: DAY_END });
    }
    return { date, weekend, ooo: ooo?.title ?? null, events: dayEvents, open };
  });
}

export function WeekCalendar({ events, tz }: { events: Event[]; tz: string }) {
  const days = planWeek(events, tz);
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Times are in {ZONE_LABEL[tz] ?? tz} time (<span className="font-mono text-[13px]">{tz}</span>), this person&apos;s local time. Open windows are
        gaps of 30 minutes or more between 09:00 and 17:30. Only free and busy are known; event titles are synthetic.
      </p>
      <ol className="flex flex-col border border-line">
        {days.map((d, i) => {
          const status = d.weekend ? (
            <Badge>Weekend</Badge>
          ) : d.ooo ? (
            <Badge tone="danger">{d.ooo}</Badge>
          ) : d.open.length === 0 ? (
            <Badge tone="danger">Fully booked</Badge>
          ) : (
            <Badge tone="success">
              {d.open.length} open {d.open.length === 1 ? "window" : "windows"}
            </Badge>
          );
          return (
            <li key={d.date} className="border-b border-line last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-sunken px-3 py-2">
                <p className="text-sm font-semibold">
                  {formatDay(d.date)}
                  {i === 0 ? <span className="ml-2 font-normal text-muted">today</span> : null}
                </p>
                {status}
              </div>
              {!d.weekend && !d.ooo ? (
                <div className="px-3 py-2">
                  {d.open.length ? (
                    <p className="mb-2 text-sm">
                      <span className="font-medium">Open:</span>{" "}
                      <span className="font-mono text-[13px]">{d.open.map((o) => `${fmt(o.start)} to ${fmt(o.end)}`).join(", ")}</span>
                    </p>
                  ) : null}
                  {d.events.length ? (
                    <ul className="flex flex-col gap-1 text-sm">
                      {d.events.map((e) => (
                        <li key={e.id} className="grid grid-cols-[7.5rem_1fr_auto] items-baseline gap-3">
                          <span className="font-mono text-[13px] text-muted">
                            {localTime(e.startsAt, tz)} to {localTime(e.endsAt, tz)}
                          </span>
                          <span className="min-w-0 truncate">{e.title}</span>
                          <span className="text-[12px] text-subtle whitespace-nowrap">
                            {KIND_LABEL[e.kind] ?? e.kind}, {e.busy ? "busy" : "free"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">No events.</p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
