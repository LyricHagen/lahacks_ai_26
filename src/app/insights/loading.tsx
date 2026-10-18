import { Container } from "@/components/page-header";
import { SkeletonBlock, SkeletonLine, SkeletonTable } from "@/components/ui/skeleton";

/** Same shape as /insights: header, rules box, panels, ToC column. */
export default function Loading() {
  return (
    <Container>
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="6rem" className="mb-2 h-2.5" />
        <SkeletonLine width="10rem" className="h-6" />
        <SkeletonLine width="60%" className="mt-3" />
      </div>
      <div className="flex flex-col-reverse gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="flex flex-col gap-10">
          <SkeletonBlock height={180} />
          <SkeletonBlock height={200} />
          <SkeletonTable rows={6} cols={5} />
        </div>
        <div className="flex flex-col gap-2">
          {[70, 55, 80, 45, 60].map((w) => (
            <SkeletonLine key={w} width={`${w}%`} />
          ))}
        </div>
      </div>
    </Container>
  );
}
