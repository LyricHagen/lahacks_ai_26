import { Container } from "@/components/page-header";
import { Skeleton, SkeletonLine, SkeletonTable } from "@/components/ui/skeleton";

/** Same shape as the directory: header, filter bar, count line, table. */
export default function Loading() {
  return (
    <Container>
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="6rem" className="mb-2 h-2.5" />
        <SkeletonLine width="12rem" className="h-6" />
        <SkeletonLine width="60%" className="mt-3" />
      </div>
      <div className="mb-6 grid gap-3 border border-line bg-raised p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <SkeletonLine width="40%" className="h-2.5" />
            <Skeleton className="h-10" />
          </div>
        ))}
      </div>
      <SkeletonLine width="18rem" className="mb-3" />
      <SkeletonTable rows={12} cols={7} />
    </Container>
  );
}
