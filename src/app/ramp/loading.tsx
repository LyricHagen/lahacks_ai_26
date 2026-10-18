import { Container } from "@/components/page-header";
import { RampSkeleton } from "@/components/ramp/ramp-page";
import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

/** Same shape as /ramp: header with button, week tabs, plan and side card. */
export default function Loading() {
  return (
    <Container>
      <div className="mb-8 flex items-end justify-between gap-4 border-b border-line pb-5">
        <div className="flex-1">
          <SkeletonLine width="6rem" className="mb-2 h-2.5" />
          <SkeletonLine width="12rem" className="h-6" />
          <SkeletonLine width="50%" className="mt-3" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="mb-8 flex gap-4 border-b border-line pb-2">
        <SkeletonLine width="5rem" />
        <SkeletonLine width="5rem" />
      </div>
      <RampSkeleton />
    </Container>
  );
}
