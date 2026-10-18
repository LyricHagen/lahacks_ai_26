import { Badge } from "@/components/ui/badge";
import { URGENCY_LABEL } from "@/lib/ask-state";
import { ARTIFACT_LABEL, HELP_KIND_LABEL, type Understanding } from "@/lib/understanding";

const VIA_LABEL = { model: "read by the model", fixture: "cached demo reading", keywords: "read by keyword matching" } as const;

/** Read-only view of the confirmed understanding, shown once the ask has moved past confirming. */
export function UnderstandingSummary({ u }: { u: Understanding }) {
  return (
    <div className="grid gap-3 text-[13px]">
      <p className="text-[15px]">{u.restatement || <span className="text-muted">No restatement (asked before prompt 5).</span>}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="text-muted">Services</dt>
        <dd className="flex flex-wrap gap-1.5">{u.services.length ? u.services.map((s) => <Badge key={s.id}>{s.name}</Badge>) : <span className="text-muted">none</span>}</dd>
        <dt className="text-muted">Skills</dt>
        <dd className="flex flex-wrap gap-1.5">{u.skills.length ? u.skills.map((s) => <Badge key={s.id}>{s.name}</Badge>) : <span className="text-muted">none</span>}</dd>
        {u.artifacts.length ? (
          <>
            <dt className="text-muted">Mentioned</dt>
            <dd className="flex flex-wrap gap-1.5">
              {u.artifacts.map((a, i) => (
                <Badge key={i}>
                  {ARTIFACT_LABEL[a.kind]}: {a.text}
                </Badge>
              ))}
            </dd>
          </>
        ) : null}
        <dt className="text-muted">Help</dt>
        <dd>
          {HELP_KIND_LABEL[u.helpKind]}, {URGENCY_LABEL[u.urgency]}
        </dd>
        {u.sensitive.length ? (
          <>
            <dt className="text-muted">Left out</dt>
            <dd>
              {u.sensitive.length} {u.sensitive.length === 1 ? "detail" : "details"} will be kept out of any drafted message.
            </dd>
          </>
        ) : null}
      </dl>
      <p className="font-mono text-[12px] text-muted">
        {VIA_LABEL[u.via]}
        {u.editedByUser ? `, corrected by you (${u.edits.length} ${u.edits.length === 1 ? "change" : "changes"})` : ", confirmed as read"}
        {u.note ? `. ${u.note}` : ""}
        {u.parse ? `. ${u.parse.line}` : ""}
      </p>
    </div>
  );
}
