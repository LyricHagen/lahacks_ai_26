import { Container } from "@/components/page-header";
import { Skeleton, SkeletonCard, SkeletonLine, SkeletonList } from "@/components/ui/skeleton";

/** Same shape as the dashboard: header with button, open asks, activity, persona card. */
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
      <SkeletonLine width="22rem" className="mb-8 h-4" />
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-8">
          <SkeletonList count={3} />
          <SkeletonList count={4} />
        </div>
        <div className="flex flex-col gap-6">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
        </div>
      </div>
    </Container>
  );
}
