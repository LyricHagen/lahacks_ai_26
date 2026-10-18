import { Container } from "@/components/page-header";
import { Skeleton, SkeletonCard, SkeletonLine, SkeletonList, SkeletonTable } from "@/components/ui/skeleton";

/** Same shape as the ask page: header, state line, progress bar, current step, ask card, history. */
export default function Loading() {
  return (
    <Container className="max-w-4xl">
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="7rem" className="mb-2 h-2.5" />
        <SkeletonLine width="70%" className="h-6" />
      </div>
      <SkeletonLine width="14rem" className="mb-6" />
      <SkeletonLine width="20rem" className="mb-2" />
      <Skeleton className="mb-8 h-12" />
      <div className="grid gap-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-11" />
          <SkeletonList count={3} />
        </div>
        <SkeletonCard lines={4} />
        <SkeletonTable rows={3} cols={5} />
      </div>
    </Container>
  );
}
