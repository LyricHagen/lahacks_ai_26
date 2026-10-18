// The prompt the fine-tuned understand_ask model was trained on, defined once. Training data prep
// (scripts/train/prep.ts), the eval (scripts/train/eval.ts) and the runtime provider tier
// (src/lib/model-purposes.ts) all build their messages here, so the model always sees exactly the
// format it learned. No server imports: scripts load it directly.
//
// Two prompts:
//   compactMessages  short instruction plus the catalog; for the fine-tune (it learned the rules)
//   fullMessages     the frontier prompt's rules plus the same catalog; for the base model prompted
//
// Changing either string changes what the fine-tune sees: retrain (scripts/train/README.md) or
// bump UNDERSTAND_PROMPT_VERSION so the eval table says which prompt it measured.

import type { Catalog } from "./understanding";

export const UNDERSTAND_PROMPT_VERSION = "compact-v1";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** One line per service and skill. Stable order (by id) so a serving prefix cache can reuse it. */
export function catalogBlock(catalog: Catalog): string {
  const services = [...catalog.services].sort((a, b) => a.id.localeCompare(b.id));
  const skills = [...catalog.skills].sort((a, b) => a.id.localeCompare(b.id));
  return [
    "Services:",
    ...services.map((s) => `${s.id} ${s.name}: ${s.description ?? ""}`.trim()),
    "Skills:",
    ...skills.map((s) => `${s.id} ${s.name}${s.aliases.length ? ` (${s.aliases.join(", ")})` : ""}`),
  ].join("\n");
}

const COMPACT_SYSTEM = "Read a new hire's question at Ferndale Systems and return the understand_ask JSON. Use only ids from the catalog.";

export function compactMessages(text: string, catalog: Catalog): ChatMessage[] {
  return [
    { role: "system", content: `${COMPACT_SYSTEM}\n\n${catalogBlock(catalog)}` },
    { role: "user", content: text },
  ];
}

export const FULL_RULES = [
  "You read a question a new hire at Ferndale Systems (freight software) typed, and return strict JSON describing it.",
  'Return only one JSON object with exactly these keys: {"restatement": string, "serviceIds": string[], "skillIds": string[], "artifacts": [{"kind": "repo"|"error"|"dashboard"|"ticket"|"link"|"other", "text": string}], "helpKind": "where_is"|"how_works"|"is_expected"|"unblock"|"who_decides", "urgency": "blocked_now"|"blocked_today"|"curious"|null, "sensitive": [{"text": string, "why": string}]}',
  "Rules:",
  '- restatement: one plain English sentence in the second person ("You ...") saying what they need. No names of people, nothing from the sensitive list, no em dashes or en dashes.',
  "- serviceIds and skillIds: only ids from the catalog below. Include a service when the question is about it even if they did not use its exact name. Never invent ids.",
  "- artifacts: things they mention that a helper would want to see: repo, error (the exact error text), dashboard, ticket, link. Copy the text exactly.",
  "- helpKind: where_is (where something lives), how_works (how something works), is_expected (is this behaviour normal), unblock (something fails and they are stuck), who_decides (a decision or approval).",
  "- urgency: blocked_now, blocked_today or curious if the text says so, otherwise null.",
  "- sensitive: exact substrings that should stay out of a message to a colleague: credentials, personal contact details, health, pay, immigration, HR or legal matters, customer personal data. Empty when there are none.",
  "- The question may be in any language; the restatement is always English.",
].join("\n");

export function fullMessages(text: string, catalog: Catalog): ChatMessage[] {
  return [
    { role: "system", content: `${FULL_RULES}\n\nCatalog:\n${catalogBlock(catalog)}` },
    { role: "user", content: text },
  ];
}

/** Small models sometimes wrap JSON in a code fence or add a sentence; take the first object. */
export function extractJsonObject(text: string): string {
  const t = text.trim();
  if (t.startsWith("{")) return t;
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}
