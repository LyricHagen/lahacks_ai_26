// The channel recommendation as an explicit suggestion with its reason. The default is to not
// interrupt anyone, so the badge says plainly whether this suggestion takes their time.

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Recommendation } from "@/lib/availability-types";

export function RecommendationBox({ rec, personId }: { rec: Recommendation; personId: string }) {
  const interrupts = rec.channel !== "async";
  return (
    <div className="grid gap-1 border border-line-strong bg-sunken px-3 py-2" data-rule={rec.rule} data-channel={rec.channel} data-target={rec.targetId}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-[13px] font-semibold">Suggested: {rec.headline}</p>
        {interrupts ? <Badge tone="accent">Takes {rec.channel === "call" ? "a call" : "a few minutes"}</Badge> : <Badge>No interruption</Badge>}
      </div>
      <p className="text-[13px]">{rec.reason}</p>
      {rec.targetId !== personId ? (
        <p className="text-[12px]">
          <Link href={`/directory/${rec.targetId}`}>See {rec.targetName}</Link>
        </p>
      ) : null}
      <p className="font-mono text-[11px] text-subtle">rule {rec.rule}</p>
    </div>
  );
}
