// The guided demo, defined once: the persona key, the steps (each its own URL under /demo), the
// guided ask and the ask history the demo account starts with. Client-safe (no server imports):
// the step pages, the banner and src/lib/demo.ts (which builds the state) all read it.

import type { AskUrgency } from "./ask-state";

/** Planted key of the demo persona (src/seed/demo-persona.ts). Only the demo account plays it. */
export const DEMO_PERSONA_KEY = "newhire_backend";

/** The shared demo account. `.invalid` is a reserved domain, so it can never be a real address. */
export const DEMO_EMAIL = "demo@altostratus.invalid";

/** How the narration refers to the demo persona (the owner chose he/him for Robert Barajas). */
export const DEMO_PERSONA_PRONOUNS = { subject: "he", object: "him", possessive: "his" } as const;

export type DemoStepSlug = "ask" | "match" | "message" | "try";

/** `line` is the one sentence the overview shows for the step. */
export type DemoStep = { slug: DemoStepSlug; title: string; short: string; line: string };

export const DEMO_STEPS: DemoStep[] = [
  { slug: "ask", title: "Describe the problem", short: "Ask", line: "Type it in plain words. Altostratus reads it and checks the docs first." },
  { slug: "match", title: "Find the right person", short: "Match", line: "Ranked from evidence, skipping anyone already overloaded." },
  { slug: "message", title: "Send the message", short: "Message", line: "A ready draft. You send it yourself, and their weekly count goes up." },
  { slug: "try", title: "Try your own", short: "Your turn", line: "Ask anything and watch the same steps run." },
];

/** The eight step addresses of the first guided demo, redirected so links to them keep working. */
export const DEMO_STEP_ALIASES: Record<string, DemoStepSlug> = {
  problem: "ask",
  understanding: "ask",
  documents: "ask",
  shortlist: "match",
  reroute: "match",
  draft: "message",
  sent: "message",
};

export function demoStep(slug: string): { step: DemoStep; n: number; prev: DemoStep | null; next: DemoStep | null } | null {
  const i = DEMO_STEPS.findIndex((s) => s.slug === slug);
  if (i < 0) return null;
  return { step: DEMO_STEPS[i], n: i + 1, prev: DEMO_STEPS[i - 1] ?? null, next: DEMO_STEPS[i + 1] ?? null };
}

export const demoStepHref = (slug: DemoStepSlug) => `/demo/${slug}`;

/** One ask the reset creates, run through the real pipeline in demo mode. */
export type DemoAskDef = {
  key: string;
  body: string;
  tried: string;
  urgency: AskUrgency;
  /** Service the asker confirms on the confirm screen (added as a correction if the reading missed it). */
  confirmService?: string;
  /** How far the reset takes it. */
  outcome: { kind: "doc_answered"; docId: string } | { kind: "answered"; note: string } | { kind: "sent" } | { kind: "ready" };
  /** Wall and app time are moved back this many days, so the history reads as history. */
  daysAgo: number;
};

/**
 * The guided ask: a failing deploy of billing-service. The webhook secret runbook is offered (it
 * scores over the doc threshold) but covers rotating the secret, not pods that cannot see it; the
 * primary owner is far over their weekly limit, so the shortlist goes to the backup owner.
 * pnpm demo:check verifies every part of that story after a reset.
 */
/** The service the guided story is about. */
export const GUIDED_SERVICE = "svc_billing";

export const GUIDED_ASK: DemoAskDef = {
  key: "guided",
  body: 'My deploy of billing-service to staging fails. The new pods crash on start with "webhook signing secret not set", so the rollout stops at 1 of 3 pods ready. Who can help me get it unstuck?',
  tried: "Restarted billing-service twice and checked that the staging Stripe secret exists.",
  urgency: "blocked_now",
  confirmService: GUIDED_SERVICE,
  outcome: { kind: "ready" },
  daysAgo: 0,
};

/**
 * What the persona asked before the demo starts, oldest first. None of these is about billing, so
 * nobody on the guided shortlist is cooled down or loaded by them.
 */
export const DEMO_HISTORY: DemoAskDef[] = [
  {
    key: "staging_db",
    body: "How do I request read access to the staging database? I want to look at the payouts tables.",
    tried: "",
    urgency: "curious",
    confirmService: "svc_access",
    outcome: { kind: "doc_answered", docId: "doc_staging_db_access" },
    daysAgo: 9,
  },
  {
    key: "invoice_pdf",
    body: "Where does invoice-worker build the PDF for a monthly invoice, and how do I render one locally to check a layout change?",
    tried: "Found the templates folder but could not tell which template the monthly run uses.",
    urgency: "blocked_today",
    confirmService: "svc_invoicing",
    outcome: { kind: "answered", note: "The monthly run uses templates/monthly.html; make preview renders one from a staging invoice id." },
    daysAgo: 6,
  },
  {
    key: "payout_lag",
    body: "Consumer lag on the carrier payout events in ingest-pipeline has been growing since yesterday's backfill. Is that expected, or should someone look at it?",
    tried: "Checked the Airflow run for the backfill; it finished without errors.",
    urgency: "blocked_today",
    confirmService: "svc_ingest",
    outcome: { kind: "sent" },
    daysAgo: 2,
  },
];
