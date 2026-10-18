import { Container } from "@/components/page-header";
import { Skeleton, SkeletonCard, SkeletonLine, SkeletonText } from "@/components/ui/skeleton";

/** Same shape as a guided step: header, step row, narration, the step's panel, back and next. */
export default function Loading() {
  return (
    <Container className="max-w-5xl">
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="6rem" className="mb-2 h-2.5" />
        <SkeletonLine width="50%" className="h-6" />
      </div>
      <Skeleton className="mb-8 h-9" />
      <div className="mb-6 max-w-[70ch]">
        <SkeletonText lines={3} />
      </div>
      <SkeletonCard lines={6} />
      <Skeleton className="mt-10 h-10" />
    </Container>
  );
}
