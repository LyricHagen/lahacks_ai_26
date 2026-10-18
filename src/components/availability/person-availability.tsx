// Server side: the availability section of /directory/[personId]. Reads a promise created inside
// withPage (availabilityForPerson), so it streams in behind PersonAvailabilitySkeleton.

import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";
import { URGENCY_HINT, URGENCY_LABEL } from "@/lib/ask-state";
import type { PersonAvailability } from "@/lib/availability";
import { ZONE_LABEL } from "@/lib/time";
import { RecommendationBox } from "./recommendation";
import { WeekStrip, WeekStripSkeleton } from "./week-strip";

export async function PersonAvailabilityPanel({ promise, personId, firstName }: { promise: Promise<PersonAvailability | null | "failed">; personId: string; firstName: string }) {
  const a = await promise;
  if (a === "failed") return <p className="font-mono text-[12px] text-danger">AVAILABILITY_FAILED: free and busy times could not be loaded</p>;
  if (!a) return <p className="text-sm text-muted">No availability for this person.</p>;
  const same = a.askerTz === a.personTz;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        {a.strip ? <WeekStrip data={a.strip} /> : null}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Working hours</dt>
          <dd>09:00 to 17:30, {ZONE_LABEL[a.personTz] ?? a.personTz} time</dd>
          <dt className="text-muted">Overlap with you</dt>
          <dd>
            <span className="font-mono">{a.overlapHours}</span> working hours{same ? ", same zone" : ` (you are on ${ZONE_LABEL[a.askerTz] ?? a.askerTz} time)`}
          </dd>
        </dl>
      </div>
      <ul className="grid border border-line" aria-label={`When to reach ${firstName}, by urgency`}>
        {a.byUrgency.map((u) => (
          <li key={u.urgency} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4" data-urgency={u.urgency}>
            <div>
              <p className="text-sm font-semibold">If you are {URGENCY_LABEL[u.urgency].toLowerCase()}</p>
              <p className="text-[12px] text-muted">{URGENCY_HINT[u.urgency]}</p>
            </div>
            <div className="grid min-w-0 gap-2">
              <p className="text-sm">
                <span className="text-muted">Next window: </span>
                {u.window ? (
                  <>
                    {u.window.label}
                    {u.window.soft ? ", in focus time" : ""}
                    {u.window.outsideAskerHours ? ", outside your working hours" : ""}
                  </>
                ) : (
                  "nothing open in the next 14 days"
                )}
              </p>
              <p className="text-[12px] text-muted">
                {u.reason}. Searched 14 days: {u.counts.hard} meetings or absences, {u.counts.soft} focus blocks.
              </p>
              <RecommendationBox rec={u.recommendation} personId={personId} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PersonAvailabilitySkeleton() {
  return (
    <div className="grid gap-5" role="status" aria-busy="true" aria-label="Loading availability">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <WeekStripSkeleton />
        <div className="grid gap-2">
          <SkeletonLine width="14rem" />
          <SkeletonLine width="11rem" />
        </div>
      </div>
      <div className="border border-line">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <SkeletonLine width="8rem" />
            <div className="grid gap-2">
              <SkeletonLine width="70%" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
