import { Container } from "@/components/page-header";
import { Skeleton, SkeletonCard, SkeletonLine, SkeletonText } from "@/components/ui/skeleton";

/** The PageHeader shape: eyebrow, title, description, bottom rule. */
export function HeaderSkeleton() {
  return (
    <div className="mb-8 border-b border-line pb-5">
      <SkeletonLine width="7rem" className="mb-2 h-2.5" />
      <SkeletonLine width="16rem" className="h-6" />
      <SkeletonLine width="55%" className="mt-3" />
    </div>
  );
}

/** A long-form page with a side column: /docs/[docId], /projects/[projectId]. */
export function ArticleSkeleton({ side = true }: { side?: boolean }) {
  return (
    <Container>
      <HeaderSkeleton />
      <div className={side ? "grid gap-8 md:grid-cols-[1fr_18rem]" : "grid gap-8"}>
        <div className="grid gap-6">
          <SkeletonText lines={4} />
          <SkeletonText lines={5} />
          <SkeletonText lines={3} />
        </div>
        {side ? <SkeletonCard lines={4} /> : null}
      </div>
    </Container>
  );
}

/** Stacked cards: /account, /pending. */
export function CardsSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <Container>
      <HeaderSkeleton />
      <div className="grid max-w-2xl gap-6">
        {Array.from({ length: cards }, (_, i) => (
          <SkeletonCard key={i} lines={3} />
        ))}
      </div>
    </Container>
  );
}

/** The draft editor: tabs, a message mock and the side cards. */
export function DraftSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="grid gap-4">
        <div className="flex gap-4 border-b border-line pb-2">
          <SkeletonLine width="5rem" />
          <SkeletonLine width="5rem" />
          <SkeletonLine width="5rem" />
        </div>
        <Skeleton className="h-72 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="grid content-start gap-4">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </div>
    </div>
  );
}
