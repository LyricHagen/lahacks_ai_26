import { Container } from "@/components/page-header";
import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

/** Same shape as the composer: header, persona line, big textarea, example buttons, details bar. */
export default function Loading() {
  return (
    <Container className="max-w-3xl">
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="5rem" className="mb-2 h-2.5" />
        <SkeletonLine width="16rem" className="h-6" />
        <SkeletonLine width="80%" className="mt-3" />
      </div>
      <SkeletonLine width="60%" className="mb-6" />
      <Skeleton className="mb-6 h-48" />
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <Skeleton className="mb-6 h-12" />
      <Skeleton className="h-10 w-36" />
    </Container>
  );
}
