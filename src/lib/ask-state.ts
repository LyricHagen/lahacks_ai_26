// The ask lifecycle, defined once. Every feature moves an ask through transitionAsk (in
// src/lib/ask-transition.ts), which checks canTransition against ASK_TRANSITIONS below, writes one
// ask_events row and logs one line:
//
//   [ask.state] INFO ask_1000 transition understanding -> retrieving actor=system reason="..."
//
// grep the ask id to read its whole history. Illegal moves throw ASK_ILLEGAL_TRANSITION.
//
// This file has no server imports, so the client progress indicator renders from the same
// definition the server enforces.
//
//   draft -> understanding -> confirming -> retrieving -> ranking -> shortlist -> drafting -> ready -> sent -> answered | stale | abandoned

export const ASK_STATES = ["draft", "understanding", "confirming", "retrieving", "ranking", "shortlist", "drafting", "ready", "sent", "answered", "stale", "abandoned"] as const;
export type AskState = (typeof ASK_STATES)[number];

/**
 * compose: the user is still writing. processing: the server is working and the page polls a
 * live status line. review: waiting on the user. outcome: after the message went out (or the ask
 * was dropped).
 */
export type AskPhase = "compose" | "processing" | "review" | "outcome";

export type AskStateDef = {
  label: string;
  phase: AskPhase;
  /** One sentence for the ask page. */
  description: string;
  /** The prompt in the build plan that makes this state do real work (for placeholders). */
  builtInPrompt: number;
  /** True when no transition leaves this state. */
  terminal: boolean;
};

export const ASK_STATE_DEFS: Record<AskState, AskStateDef> = {
  draft: { label: "Draft", phase: "compose", description: "Written but not submitted yet.", builtInPrompt: 4, terminal: false },
  understanding: { label: "Understanding", phase: "processing", description: "Reading the ask: which services, skills and urgency it involves.", builtInPrompt: 4, terminal: false },
  confirming: {
    label: "Confirm",
    phase: "review",
    description: "Check what Altostratus understood, fix it if needed, and see whether a document already answers it.",
    builtInPrompt: 5,
    terminal: false,
  },
  retrieving: { label: "Retrieving", phase: "processing", description: "Searching the company for people and documents related to the ask.", builtInPrompt: 5, terminal: false },
  ranking: { label: "Ranking", phase: "processing", description: "Scoring candidates on ownership, evidence, load and availability.", builtInPrompt: 6, terminal: false },
  shortlist: { label: "Shortlist", phase: "review", description: "A short list of people, with why each one, for you to pick from.", builtInPrompt: 6, terminal: false },
  drafting: { label: "Drafting", phase: "processing", description: "Checking when the chosen person is free and writing the message.", builtInPrompt: 8, terminal: false },
  ready: { label: "Ready", phase: "review", description: "The draft is ready for you to edit, copy and send yourself.", builtInPrompt: 8, terminal: false },
  sent: { label: "Sent", phase: "outcome", description: "You sent the message. Waiting for an answer.", builtInPrompt: 8, terminal: false },
  answered: { label: "Answered", phase: "outcome", description: "Answered, by a colleague or by a document. The ask is closed.", builtInPrompt: 8, terminal: true },
  stale: { label: "Stale", phase: "outcome", description: "No answer for a while. Follow up, or try the next person.", builtInPrompt: 8, terminal: false },
  abandoned: { label: "Abandoned", phase: "outcome", description: "Dropped before it was answered.", builtInPrompt: 4, terminal: true },
};

/**
 * Allowed moves. The first entry of each list is the forward step on the main path; the
 * progress indicator walks those first entries, so reordering here reorders the UI.
 *
 * Processing states may fall back to draft when a step fails (the ask page then offers a retry).
 * stale can go back to sent (followed up) or on to drafting (try the next person on the shortlist),
 * and shortlist can be re-ranked. confirming can end the
 * ask early as answered when a document covers the question (the best ask is the one nobody has
 * to answer).
 */
export const ASK_TRANSITIONS: Record<AskState, readonly AskState[]> = {
  draft: ["understanding", "abandoned"],
  understanding: ["confirming", "draft", "abandoned"],
  confirming: ["retrieving", "answered", "abandoned"],
  retrieving: ["ranking", "draft", "abandoned"],
  ranking: ["shortlist", "draft", "abandoned"],
  shortlist: ["drafting", "ranking", "abandoned"],
  drafting: ["ready", "shortlist", "abandoned"],
  ready: ["sent", "drafting", "shortlist", "abandoned"],
  sent: ["answered", "stale", "abandoned"],
  stale: ["answered", "sent", "drafting", "abandoned"],
  answered: [],
  abandoned: [],
};

/** The states a brand new ask may be created in. */
export const ASK_INITIAL_STATES: readonly AskState[] = ["draft"];

export function isAskState(v: unknown): v is AskState {
  return typeof v === "string" && (ASK_STATES as readonly string[]).includes(v);
}

export function canTransition(from: AskState, to: AskState): boolean {
  return ASK_TRANSITIONS[from].includes(to);
}

export function isProcessing(s: AskState): boolean {
  return ASK_STATE_DEFS[s].phase === "processing";
}

export function isOpen(s: AskState): boolean {
  return !ASK_STATE_DEFS[s].terminal;
}

/** The forward path from the initial state, following the first transition of each state. */
export function mainPath(): AskState[] {
  const path: AskState[] = [];
  let s: AskState | undefined = ASK_INITIAL_STATES[0];
  while (s && !path.includes(s)) {
    path.push(s);
    if (ASK_STATE_DEFS[s].phase === "outcome") break;
    s = ASK_TRANSITIONS[s][0];
  }
  return path;
}

/** Where the main path ends: the outcomes reachable from its last state. */
export function outcomeStates(): AskState[] {
  const path = mainPath();
  const last = path[path.length - 1];
  return ASK_TRANSITIONS[last].filter((s) => ASK_STATE_DEFS[s].phase === "outcome");
}

export type ProgressStep = { state: AskState; label: string; status: "done" | "current" | "todo" };

/**
 * Steps for the progress indicator, derived from the definitions above. The last step is the
 * outcome: it shows the reached outcome, or the list of possible ones while still open.
 */
export function progressSteps(current: AskState): { steps: ProgressStep[]; outcomeLabel: string; outcomeReached: boolean; index: number; total: number } {
  const path = mainPath();
  const outcomes = outcomeStates();
  const onPath = path.indexOf(current);
  // States off the main path (stale, abandoned, answered) count as past the end of it.
  const pos = onPath >= 0 ? onPath : path.length;
  const steps: ProgressStep[] = path.map((s, i) => ({ state: s, label: ASK_STATE_DEFS[s].label, status: i < pos ? "done" : i === pos ? "current" : "todo" }));
  const outcomeReached = onPath < 0;
  const labels = outcomes.map((s) => ASK_STATE_DEFS[s].label);
  const outcomeLabel = outcomeReached ? ASK_STATE_DEFS[current].label : labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : (labels[0] ?? "");
  return { steps, outcomeLabel, outcomeReached, index: Math.min(pos, path.length) + 1, total: path.length + 1 };
}

export type AskActor = "user" | "system";

export const URGENCIES = ["blocked_now", "blocked_today", "curious"] as const;
export type AskUrgency = (typeof URGENCIES)[number];

export const URGENCY_LABEL: Record<AskUrgency, string> = {
  blocked_now: "Blocked now",
  blocked_today: "Blocked today",
  curious: "Just curious",
};

export const URGENCY_HINT: Record<AskUrgency, string> = {
  blocked_now: "Can take someone's time: a direct message or a short call if they are free.",
  blocked_today: "A direct message they can answer within the day.",
  curious: "An asynchronous message only. Nobody gets interrupted for this.",
};
