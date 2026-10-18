import type { ReactNode } from "react";
import { type AskState, ASK_STATE_DEFS } from "@/lib/ask-state";

/** Labelled placeholder for a state whose screen or step a later prompt builds. Never a crash. */
export function NotBuiltPanel({ state, children }: { state: AskState; children?: ReactNode }) {
  const def = ASK_STATE_DEFS[state];
  return (
    <div className="border border-dashed border-line-strong bg-raised px-5 py-4" data-state={state}>
      <p className="font-semibold">
        {def.label}: not built yet, prompt {def.builtInPrompt}
      </p>
      <p className="mt-1 text-sm text-muted">{def.description}</p>
      <p className="mt-1 text-sm text-muted">The ask is safely parked in this state. Nothing is lost; it continues from here once that step exists.</p>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
