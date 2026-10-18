// Server side: one week strip read from a shared promise (loadWeekStrips), so a page renders every
// strip from one query while each shows its own skeleton until the data arrives. The promise is
// created inside withPage and already catches and logs its own failure (null here).

import type { WeekStripData } from "@/lib/availability-types";
import { WeekStrip } from "./week-strip";

export async function StripSlot({ promise, id, compact, legend }: { promise: Promise<Map<string, WeekStripData> | null>; id: string; compact?: boolean; legend?: boolean }) {
  const map = await promise;
  const data = map?.get(id);
  if (!map) return <p className="font-mono text-[12px] text-danger">AVAILABILITY_FAILED: free and busy times could not be loaded</p>;
  if (!data) return <p className="text-[12px] text-muted">No calendar for this person.</p>;
  return <WeekStrip data={data} compact={compact} legend={legend} />;
}
