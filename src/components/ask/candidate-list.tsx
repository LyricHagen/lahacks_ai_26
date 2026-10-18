import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import type { CandidateView } from "@/lib/ask-review";
import { PATH_LABEL } from "@/lib/retrieval-paths";

/** Candidates before ranking: alphabetical, no scores, every claim backed by an evidence sentence. */
export function CandidateList({ candidates }: { candidates: CandidateView[] }) {
  if (!candidates.length) {
    return <EmptyState title="Nobody matched yet" body="No owner, project, skill, profile or document pointed at anyone. Name the service or tool you are working with and ask again." />;
  }
  return (
    <ul className="divide-y divide-line border border-line">
      {candidates.map((c) => (
        <li key={c.employeeId} className="px-4 py-3" data-candidate={c.employeeId}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link href={`/directory/${c.employeeId}`} className="font-semibold">
              {c.name}
            </Link>
            <span className="text-sm text-muted">
              {c.title}, {c.team}
            </span>
            <span className="font-mono text-[12px] text-muted">{c.employeeId}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.sources.map((s) => (
              <Badge key={s}>{PATH_LABEL[s]}</Badge>
            ))}
          </div>
          <ul className="mt-2 grid gap-1 text-[13px]">
            {c.evidence.map((e, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)] gap-0.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
                <span>{e.detail}</span>
                <span className="font-mono text-[11px] text-subtle">{e.source}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
