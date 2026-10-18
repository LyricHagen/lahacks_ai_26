import { Container } from "@/components/page-header";
import { Skeleton, SkeletonCard, SkeletonLine, SkeletonList } from "@/components/ui/skeleton";

/** Same shape as the overview: header, step row, the numbered path and the persona card. */
export default function Loading() {
  return (
    <Container className="max-w-4xl">
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="4rem" className="mb-2 h-2.5" />
        <SkeletonLine width="40%" className="h-6" />
      </div>
      <Skeleton className="mb-8 h-9" />
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_18rem]">
        <SkeletonList count={8} />
        <SkeletonCard lines={4} />
      </div>
    </Container>
  );
}
