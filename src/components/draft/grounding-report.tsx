// What the grounding check did to each variant, and what was kept out of the input. Shown under
// the draft so the asker can see that nothing was made up and nothing private went in.

import type { DraftSummary } from "@/lib/ask-draft-step";
import { DRAFT_VARIANTS, VARIANT_DEF } from "@/lib/draft";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

const VIA_LINE = {
  model: "Written by the model from the input below, then checked.",
  demo: "Cached demo draft, built from the same input and checked the same way as a live one.",
  template: "Built from the input with fixed sentences, then checked.",
} as const;

export function GroundingReport({ summary: s }: { summary: DraftSummary }) {
  const stripped = DRAFT_VARIANTS.flatMap((v) => s.grounding[v].stripped.map((x) => ({ v, ...x })));
  const kept = s.scrub.triedSentencesRemoved + s.scrub.mentionedRemoved + s.scrub.restatementSentencesRemoved;
  return (
    <Card>
      <CardHeader title="Grounding check" meta={VIA_LINE[s.via]} />
      <CardBody className="grid gap-3 text-sm">
        <p>Every service, repo, project and person named in a draft must come from your confirmed ask or from {s.recipient.firstName}&apos;s evidence. A sentence that names anything else is removed.</p>
        <ul className="grid gap-1">
          {DRAFT_VARIANTS.map((v) => (
            <li key={v} className="flex flex-wrap items-center gap-2">
              <span className="w-28 text-[13px]">{VARIANT_DEF[v].label}</span>
              {s.grounding[v].ok ? <Badge tone="success">Passed</Badge> : <Badge tone="danger">{s.grounding[v].stripped.length} removed</Badge>}
              <span className="font-mono text-[12px] text-muted">{s.grounding[v].words} words</span>
              {s.grounding[v].fellBack ? <span className="text-[12px] text-muted">nothing was left, so the plain version is shown</span> : null}
            </li>
          ))}
        </ul>
        {stripped.length ? (
          <div className="grid gap-1 border-t border-line pt-3">
            <p className="text-[13px] font-medium">Removed sentences</p>
            <ul className="grid gap-1 text-[13px]">
              {stripped.map((x, i) => (
                <li key={i}>
                  <span className="text-muted">{VARIANT_DEF[x.v].label}, {x.field}:</span> &quot;{x.sentence}&quot; <span className="text-muted">({x.names.length ? x.names.join(", ") : x.why})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="border-t border-line pt-3 text-[13px] text-muted">
          {s.scrub.protectedSpans
            ? `Kept out before drafting: ${s.scrub.protectedSpans} item${s.scrub.protectedSpans === 1 ? "" : "s"} you marked to leave out or put in the confidential note${kept ? ` (${kept} sentence${kept === 1 ? "" : "s"} removed from the input)` : ""}. They were never sent to a model.`
            : "Nothing in this ask was marked to leave out, and there is no confidential note."}
        </p>
      </CardBody>
    </Card>
  );
}
