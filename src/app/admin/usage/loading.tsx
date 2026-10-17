import { Container } from "@/components/page-header";
import { SkeletonLine, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <Container>
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="7rem" className="mb-2 h-2.5" />
        <SkeletonLine width="14rem" className="h-6" />
        <SkeletonLine width="55%" className="mt-3" />
      </div>
      <SkeletonTable rows={6} cols={7} />
    </Container>
  );
}
