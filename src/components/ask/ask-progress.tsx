import { type AskState, ASK_STATE_DEFS, progressSteps } from "@/lib/ask-state";
import { cn } from "@/components/ui/cn";

/**
 * Progress indicator built from the state machine (src/lib/ask-state.ts): the main path is the
 * chain of forward transitions, and the last step lists the possible outcomes. Status is shown
 * by weight, a text marker and aria-current, not by color alone.
 */
export function AskProgress({ state, className }: { state: AskState; className?: string }) {
  const p = progressSteps(state);
  const def = ASK_STATE_DEFS[state];
  return (
    <div className={className}>
      <p className="mb-2 text-sm">
        <span className="font-mono text-[12px] text-muted">
          step {p.index} of {p.total}
        </span>{" "}
        <span className="font-semibold">{def.label}</span>
        <span className="text-muted">: {def.description}</span>
      </p>
      <ol className="flex overflow-x-auto border border-line bg-raised" aria-label="Ask progress">
        {p.steps.map((s, i) => (
          <li
            key={s.state}
            aria-current={s.status === "current" ? "step" : undefined}
            className={cn(
              "min-w-[6.5rem] flex-1 border-r border-line px-2.5 py-2 text-[13px] whitespace-nowrap",
              s.status === "current" && "bg-accent-soft font-semibold text-fg border-b-2 border-b-accent",
              s.status === "done" && "text-fg",
              s.status === "todo" && "text-subtle",
            )}
          >
            <span className="block font-mono text-[11px] text-muted">
              {String(i + 1).padStart(2, "0")} {s.status === "done" ? "done" : s.status === "current" ? "now" : ""}
            </span>
            {s.label}
          </li>
        ))}
        <li
          aria-current={p.outcomeReached ? "step" : undefined}
          className={cn("min-w-[11rem] flex-1 px-2.5 py-2 text-[13px]", p.outcomeReached ? "bg-accent-soft font-semibold border-b-2 border-b-accent" : "text-subtle")}
        >
          <span className="block font-mono text-[11px] text-muted">
            {String(p.steps.length + 1).padStart(2, "0")} {p.outcomeReached ? "now" : "outcome"}
          </span>
          {p.outcomeLabel}
        </li>
      </ol>
    </div>
  );
}
