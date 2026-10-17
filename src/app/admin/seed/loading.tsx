import { Container } from "@/components/page-header";
import { SkeletonCard, SkeletonLine, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <Container>
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="7rem" className="mb-2 h-2.5" />
        <SkeletonLine width="14rem" className="h-6" />
        <SkeletonLine width="55%" className="mt-3" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <SkeletonCard lines={7} />
        <SkeletonCard lines={3} />
      </div>
      <SkeletonLine width="8rem" className="mb-3 mt-10 h-4" />
      <SkeletonTable rows={8} cols={3} />
      <SkeletonLine width="10rem" className="mb-3 mt-10 h-4" />
      <SkeletonTable rows={6} cols={5} />
    </Container>
  );
}
