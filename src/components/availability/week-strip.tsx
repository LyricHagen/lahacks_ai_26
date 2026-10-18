// The compact week strip: seven columns, one per day in the person's own zone, each a stack of
// half hour segments from 09:00 (top) to 17:30 (bottom). Readable without color: a meeting or
// absence fills the whole segment width, focus time fills half of it, free is empty, and every
// column carries a spoken summary (aria-label and title). No hooks, so it renders on the server
// and inside client components alike.

import { Skeleton } from "@/components/ui/skeleton";
import { type StripSegment, stripDayText, type WeekStripData } from "@/lib/availability-types";

const COL_H = { regular: "h-[72px]", compact: "h-[54px]" } as const;

function Segment({ s, past }: { s: StripSegment; past: boolean }) {
  const fade = past ? "opacity-35" : "";
  if (s === "hard") return <span className={`flex-1 bg-fg ${fade}`} />;
  if (s === "soft")
    return (
      <span className={`flex flex-1 ${fade}`}>
        <span className="w-1/2 bg-muted" />
      </span>
    );
  return <span className="flex-1" />;
}

export function WeekStrip({ data, compact = false, legend = true }: { data: WeekStripData; compact?: boolean; legend?: boolean }) {
  const h = compact ? COL_H.compact : COL_H.regular;
  return (
    <figure className="grid gap-2" data-week-strip={data.employeeId}>
      <ol className="flex gap-1" aria-label={`Busy time over the next ${data.days.length} days, working hours in ${data.zoneLabel} time`}>
        {data.days.map((d) => {
          const text = stripDayText(d);
          return (
            <li key={d.date} className="flex w-6 flex-col items-center gap-1" title={text}>
              <div role="img" aria-label={text} className={`flex w-full flex-col gap-px border p-px ${h} ${d.today ? "border-fg" : "border-line-strong"} ${d.ooo ? "bg-strong" : ""}`}>
                {d.weekend ? (
                  <span className="m-auto font-mono text-[9px] text-subtle">off</span>
                ) : d.ooo ? (
                  <span className="m-auto font-mono text-[9px] font-semibold [writing-mode:vertical-rl]">OOO</span>
                ) : (
                  d.segments.map((s, k) => <Segment key={k} s={s} past={k < d.pastSegments} />)
                )}
              </div>
              <span className={`font-mono text-[10px] leading-none ${d.today ? "font-semibold underline underline-offset-2" : "text-muted"}`}>{d.weekdayShort.slice(0, 2)}</span>
              <span className="font-mono text-[10px] leading-none text-subtle">{d.dayOfMonth}</span>
            </li>
          );
        })}
      </ol>
      {legend ? <StripLegend zoneLabel={data.zoneLabel} /> : null}
    </figure>
  );
}

export function StripLegend({ zoneLabel }: { zoneLabel: string }) {
  return (
    <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-3 bg-fg" aria-hidden="true" />
        meeting or away
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex h-2.5 w-3 border border-line-strong" aria-hidden="true">
          <span className="w-1/2 bg-muted" />
        </span>
        focus time
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-3 border border-line-strong" aria-hidden="true" />
        free
      </span>
      <span>09:00 top to 17:30 bottom, {zoneLabel} time; faded is already past</span>
    </figcaption>
  );
}

/** Same footprint as WeekStrip, static (no shimmer). */
export function WeekStripSkeleton({ compact = false, legend = true }: { compact?: boolean; legend?: boolean }) {
  const h = compact ? COL_H.compact : COL_H.regular;
  return (
    <div className="grid gap-2" role="status" aria-busy="true" aria-label="Loading free and busy times">
      <div className="flex gap-1">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex w-6 flex-col items-center gap-1">
            <Skeleton className={`w-full ${h}`} />
            <Skeleton className="h-2.5 w-4" />
            <Skeleton className="h-2.5 w-3" />
          </div>
        ))}
      </div>
      {legend ? <Skeleton className="h-2.5 w-56 max-w-full" /> : null}
    </div>
  );
}
