import { Container } from "@/components/page-header";
import { Skeleton, SkeletonCard, SkeletonLine } from "@/components/ui/skeleton";

/** Same shape as an onboarding step: header, three step tabs, a card, a form. */
export default function Loading() {
  return (
    <Container className="max-w-3xl">
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="9rem" className="mb-2 h-2.5" />
        <SkeletonLine width="14rem" className="h-6" />
        <SkeletonLine width="70%" className="mt-3" />
      </div>
      <Skeleton className="mb-8 h-12" />
      <SkeletonCard lines={4} className="mb-8" />
      <Skeleton className="h-10 w-48" />
    </Container>
  );
}
