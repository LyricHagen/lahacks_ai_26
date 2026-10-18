import { Badge } from "@/components/ui/badge";
import { type AskState, ASK_STATE_DEFS } from "@/lib/ask-state";

/** The state's word is always shown; tone only adds to it. */
export function AskStateBadge({ state }: { state: AskState }) {
  const tone = state === "answered" ? "success" : state === "abandoned" || state === "stale" ? "danger" : ASK_STATE_DEFS[state].phase === "processing" ? "accent" : "neutral";
  return <Badge tone={tone}>{ASK_STATE_DEFS[state].label}</Badge>;
}
