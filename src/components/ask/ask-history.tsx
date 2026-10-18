import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { AskEventRow } from "@/lib/asks";
import { ASK_STATE_DEFS } from "@/lib/ask-state";

function when(d: Date) {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/** Every ask_events row: the same history the log has, in the order it happened. */
export function AskHistory({ events }: { events: AskEventRow[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Time (UTC)</TH>
          <TH>Change</TH>
          <TH>Actor</TH>
          <TH>Reason</TH>
          <TH>Request</TH>
        </TR>
      </THead>
      <TBody>
        {events.map((e) => (
          <TR key={e.id}>
            <TD className="font-mono text-[12px] whitespace-nowrap">{when(e.at)}</TD>
            <TD className="whitespace-nowrap">
              {e.kind === "transition" ? (
                <>
                  <span className="text-muted">{e.fromState ? ASK_STATE_DEFS[e.fromState].label : "new"}</span> to{" "}
                  <span className="font-medium">{e.toState ? ASK_STATE_DEFS[e.toState].label : "?"}</span>
                </>
              ) : (
                <span className="text-muted">note: {e.kind.replace(/_/g, " ")}</span>
              )}
            </TD>
            <TD className="whitespace-nowrap">
              {e.actor}
              {e.actorId ? <span className="ml-1 font-mono text-[12px] text-muted">{e.actorId}</span> : null}
            </TD>
            <TD className="min-w-[16rem]">{e.reason || <span className="text-subtle">none</span>}</TD>
            <TD className="font-mono text-[12px] text-muted">{e.reqId ?? ""}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
