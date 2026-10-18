import { SkeletonLine } from "@/components/ui/skeleton";
import { PATH_LABEL, RETRIEVAL_PATHS, type RetrievalSummary } from "@/lib/retrieval-paths";

/**
 * How many people each retrieval path brought in. While retrieving, paths that have not finished
 * show a skeleton line, and each count appears as its path completes (polled from asks.retrieval).
 */
export function RetrievalCounts({ summary, live = false }: { summary: RetrievalSummary | null; live?: boolean }) {
  const paths = summary?.paths ?? [];
  return (
    <div className="border border-line">
      <ul className="divide-y divide-line">
        {RETRIEVAL_PATHS.map((p) => {
          const s = paths.find((x) => x.path === p);
          return (
            <li key={p} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm" data-path={p}>
              <span>
                {PATH_LABEL[p]} <span className="font-mono text-[12px] text-muted">{p}</span>
              </span>
              {s ? (
                s.status === "skipped" ? (
                  <span className="text-[13px] text-muted">skipped: {s.note}</span>
                ) : (
                  <span className="font-mono text-[13px]">
                    {s.people} {s.people === 1 ? "person" : "people"} <span className="text-muted">{s.ms}ms</span>
                  </span>
                )
              ) : live ? (
                <SkeletonLine width={72} />
              ) : (
                <span className="text-[13px] text-muted">not run</span>
              )}
            </li>
          );
        })}
      </ul>
      {summary?.total !== null && summary?.total !== undefined ? (
        <p className="border-t border-line bg-sunken px-4 py-2 text-[13px]">
          {summary.total} {summary.total === 1 ? "person" : "people"} after removing duplicates
          {summary.cut.length ? `, ${summary.cut.length} more left out for weaker evidence (cap of 30)` : ""}.
        </p>
      ) : null}
    </div>
  );
}
