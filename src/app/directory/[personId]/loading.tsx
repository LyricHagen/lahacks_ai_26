import { Container } from "@/components/page-header";
import { SkeletonLine, SkeletonTable, SkeletonText } from "@/components/ui/skeleton";

/** Same shape as the person page: header, summary, three tables, ToC on the right. */
export default function Loading() {
  return (
    <Container>
      <div className="mb-8 border-b border-line pb-5">
        <SkeletonLine width="8rem" className="mb-2 h-2.5" />
        <SkeletonLine width="16rem" className="h-6" />
        <SkeletonLine width="22rem" className="mt-3" />
      </div>
      <div className="flex flex-col-reverse gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex min-w-0 flex-col gap-10" role="status" aria-busy="true" aria-label="Loading">
          <div>
            <SkeletonLine width="7rem" className="mb-4 h-4" />
            <SkeletonText lines={3} />
          </div>
          {["Services owned", "Skills and evidence", "Projects"].map((s) => (
            <div key={s}>
              <SkeletonLine width="10rem" className="mb-4 h-4" />
              <SkeletonTable rows={4} cols={4} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {[70, 55, 80, 45, 60, 50].map((w, i) => (
            <SkeletonLine key={i} width={`${w}%`} className="h-2.5" />
          ))}
        </div>
      </div>
    </Container>
  );
}
