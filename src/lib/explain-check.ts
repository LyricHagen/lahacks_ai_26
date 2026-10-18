// Checks a model-written reason against the facts it was given. No server imports.
//
// The explain_ranking call gets only the evidence sentences and the score breakdown. A reason may
// rephrase them but must not add a fact. A token counts as a fact when it carries a number, a
// hyphen, dot, slash or underscore (service names, repos, versions), or a capital letter (names,
// tools, days, teams). Each such token must appear in the facts, ignoring case. Gendered pronouns
// are rejected too: nothing in the evidence says how someone is referred to, so the reason says
// "they" or uses the first name. Calling someone the owner needs ownership in the facts. A sentence that fails is dropped and the reason falls back to the
// template built from the top two components.

const PRONOUNS = new Set(["he", "she", "him", "his", "her", "hers", "himself", "herself"]);
/** Capitalised only because they start a sentence, or plain function words. */
const STARTERS = new Set([
  "they", "their", "them", "this", "that", "these", "both", "also", "and", "but", "with", "as", "a", "an", "the", "currently", "recently", "already",
  "has", "have", "is", "was", "owns", "wrote", "answered", "knows", "free", "on", "in", "for", "of", "who", "can", "could", "level", "your", "you",
]);

export type ReasonCheck = { ok: boolean; kept: string; dropped: Array<{ sentence: string; unsupported: string[] }> };

function factTokens(sentence: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z0-9][A-Za-z0-9._\-/+']*/g;
  let m: RegExpExecArray | null;
  let first = true;
  while ((m = re.exec(sentence))) {
    const tok = m[0].replace(/[.'_/+-]+$/, "").replace(/'s$/, "");
    if (!tok) continue;
    const lower = tok.toLowerCase();
    if (PRONOUNS.has(lower)) out.push(tok);
    else if (/\d/.test(tok) || /[._/+-]/.test(tok)) out.push(tok);
    else if (/^[A-Z]/.test(tok) && !(first && STARTERS.has(lower)) && !(lower === "i")) out.push(tok);
    first = false;
  }
  return out;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function checkReason(reason: string, facts: string[]): ReasonCheck {
  const corpus = facts.join("\n").toLowerCase();
  const sentences = reason
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .filter(Boolean);
  const kept: string[] = [];
  const dropped: ReasonCheck["dropped"] = [];
  for (const s of sentences) {
    const unsupported = factTokens(s).filter((tok) => {
      const lower = tok.toLowerCase();
      if (PRONOUNS.has(lower)) return true;
      return !new RegExp(`(^|[^a-z0-9])${escapeRe(lower)}($|[^a-z0-9])`).test(corpus);
    });
    // Ownership is the claim that matters most and "owns" is a plain verb the token rule skips:
    // a backup owner or a contributor must not be called the owner.
    const claimsOwner = /\b(owns|primary owner|main owner)\b/i.test(s) && !/\bbackup owner\b|\bsecondary owner\b/i.test(s);
    if (claimsOwner && !/\bowns\b|\bprimary owner\b/.test(corpus)) unsupported.push("owns");
    if (unsupported.length) dropped.push({ sentence: s, unsupported: [...new Set(unsupported)] });
    else kept.push(s);
  }
  return { ok: kept.length > 0, kept: kept.join(" "), dropped };
}

/** The UI rules forbid em and en dashes anywhere user facing; model text is cleaned before display. */
export function cleanModelText(s: string): string {
  return s
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}
