// Label-first sampling for the understand_ask training set. Each spec IS the correct answer
// (services, skills, artifacts, help kind, urgency, sensitive items) drawn from the seeded company;
// a frontier model only writes the messy new-hire text that leads to it (scripts/train/generate.ts).
// Working backwards from the label is what keeps the labels exact and the data cheap.
//
// Deterministic: the same seed string always gives the same specs.

import type { HelpKind } from "@/lib/understanding";
import { HELP_KINDS } from "@/lib/understanding";

export const CATEGORIES = ["clear", "vague", "no_vocab", "two_problems", "sensitive", "second_language"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  clear: "Clear (names the service)",
  vague: "Vague",
  no_vocab: "No company vocabulary",
  two_problems: "Two problems mixed",
  sensitive: "Contains something sensitive",
  second_language: "Second language",
};

/**
 * Never the subject of a training example. The eval's held-out set asks about only these, so it
 * measures whether the model maps a description to a catalog entry it never saw labelled.
 */
export const HOLDOUT_SERVICES = ["svc_recs", "svc_push", "svc_expenses", "svc_incident"] as const;

export type Urgency = "blocked_now" | "blocked_today" | "curious" | null;
export type SensitiveKind = "email" | "phone" | "credential" | "customer_data" | "personal";
export type SensitiveItem = { kind: SensitiveKind; why: string; /** exact text to embed; personal items are written by the generator */ text: string | null; topic: string | null };

export type Spec = {
  id: string;
  category: Category;
  /** The held-out service set (eval only), reported apart from the 300. */
  holdout: boolean;
  services: Array<{ id: string; name: string; repo: string; description: string }>;
  skills: Array<{ id: string; name: string }>;
  helpKind: HelpKind;
  urgency: Urgency;
  artifacts: Array<{ kind: "repo" | "error" | "dashboard" | "ticket" | "link"; text: string }>;
  sensitive: SensitiveItem[];
  /** May the text use service and repo names? false for no_vocab. */
  namesAllowed: boolean;
  language: string;
  style: string;
};

export type CatalogService = { id: string; name: string; repo: string; description: string; team: string; skillIds: string[] };
export type CatalogSkill = { id: string; name: string; aliases: string[] };

/** mulberry32 seeded from a string. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chance = (r: () => number, p: number) => r() < p;
function sample<T>(r: () => number, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

const STYLES = [
  "a terse Slack message, all lowercase, almost no punctuation",
  "a long rambling paragraph with backstory and an apology for asking",
  "an anxious, over-polite new hire who is not sure they are allowed to ask",
  "shorthand with abbreviations and a couple of typos (pls, rn, idk, prob)",
  "an error pasted first, then one short question under it",
  "a tidy, formal note like an email to a senior colleague",
  "the actual question buried at the end after two sentences of context",
  "two or three short lines, like messages sent one after another",
  "confident and direct, one sentence",
  "unsure of the right words, describing what they see instead of naming it",
];

const LANGUAGES = ["Spanish", "Portuguese", "French", "German", "Mandarin Chinese", "Korean", "Hindi", "Vietnamese", "Japanese", "Italian"];

const GENERIC_ERRORS = [
  "connection refused",
  "context deadline exceeded",
  "permission denied (publickey)",
  "502 Bad Gateway",
  "OOMKilled",
  "ECONNRESET",
  "certificate has expired",
  "too many open files",
  "deadlock detected",
  "rate limit exceeded",
  "NullPointerException",
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "relation \"shipments_tmp\" does not exist",
  "ImagePullBackOff",
  "CrashLoopBackOff",
  "invalid_grant",
  "403 Forbidden",
  "timeout after 30000ms",
  "checksum mismatch",
  "unexpected end of JSON input",
];

/** Errors that read as belonging to one service. Keys are service ids. */
const SERVICE_ERRORS: Record<string, string[]> = {
  svc_billing: ["No such customer: cus_8Ja2LmQ", "idempotency key already used", "card_declined"],
  svc_invoicing: ["PDF render timed out after 120s", "template variable invoice_total is undefined"],
  svc_auth: ["SAML response signature invalid", "invalid redirect_uri", "session token expired"],
  svc_profiles: ["role admin_readonly not found", "GraphQL error: Not authorized to access Organization.members"],
  svc_mobile_build: ["No signing certificate \"iOS Distribution\" found", "Execution failed for task ':app:bundleRelease'"],
  svc_push: ["APNs responded BadDeviceToken", "FCM quota exceeded for project"],
  svc_web_app: ["Hydration failed because the initial UI does not match", "ChunkLoadError: Loading chunk 412 failed"],
  svc_ui_kit: ["Module not found: Can't resolve '@ferndale/ui-kit/tokens'"],
  svc_flags: ["flag checkout_v2 has no default variant", "unknown segment beta_shippers"],
  svc_email: ["550 5.7.1 message rejected as spam", "template lifecycle_welcome missing locale es"],
  svc_build: ["cache restore failed: key not found", "runner exited with code 137"],
  svc_k8s: ["Error: UPGRADE FAILED: timed out waiting for the condition", "0/12 nodes are available: insufficient memory"],
  svc_observability: ["no data for query sum(rate(http_requests_total[5m]))", "alertmanager: notify retry canceled"],
  svc_incident: ["pager escalation policy P3 has no responders", "incident-bot: channel already exists"],
  svc_ingest: ["CommitFailedException", "DAG load_shipments failed: upstream_failed"],
  svc_warehouse: ["dbt: Compilation Error in model fct_shipments", "permission denied for schema finance"],
  svc_search: ["index shipments_v7 is read-only", "search_phase_execution_exception"],
  svc_recs: ["feature store lookup returned 0 rows", "model version recs-2026-09 not found"],
  svc_dashboards: ["Looker: unknown field orders.revenue_net", "query exceeded 60s limit"],
  svc_secrets: ["vault: permission denied on secret/data/billing", "lease expired for database credentials"],
  svc_access: ["access request AR-2291 stuck in pending_approval"],
  svc_helpdesk: ["Zendesk sync failed: 422 Unprocessable Entity", "ticket escalation webhook timed out"],
  svc_devices: ["MDM profile installation failed", "VPN: authentication failed"],
  svc_onboarding_portal: ["benefits enrollment window closed", "checklist item not found"],
  svc_expenses: ["receipt upload failed: file too large", "card transaction not matched to a report"],
};

const TICKET_PREFIX: Record<string, string> = {
  Payments: "PAY",
  Identity: "IDN",
  Mobile: "MOB",
  Web: "WEB",
  Platform: "PLAT",
  Data: "DATA",
  Search: "SRCH",
  Security: "SEC",
  Support: "SUP",
  IT: "IT",
  People: "PPL",
  Finance: "FIN",
};

function ticketFor(r: () => number, team: string): string {
  const prefix = TICKET_PREFIX[team] ?? pick(r, Object.values(TICKET_PREFIX));
  return `${prefix}-${100 + Math.floor(r() * 4900)}`;
}

function dashboardFor(r: () => number, s: CatalogService): string {
  const words = s.name.split("-").join(" ");
  return pick(r, [`${words} latency dashboard`, `${words} errors dashboard`, `Grafana ${words} overview dashboard`, `${words} SLO dashboard`]);
}

function linkFor(r: () => number, s: CatalogService): string {
  const slug = Math.floor(r() * 0xffffff).toString(16);
  return pick(r, [
    `https://grafana.ferndale.example/d/${slug}/${s.name}`,
    `https://github.com/${s.repo}/pull/${200 + Math.floor(r() * 3000)}`,
    `https://ci.ferndale.example/${s.name}/runs/${10000 + Math.floor(r() * 80000)}`,
    `https://wiki.ferndale.example/pages/${s.name}-runbook`,
  ]);
}

function artifactsFor(r: () => number, s: CatalogService, n: number) {
  const kinds = sample(r, ["error", "error", "ticket", "dashboard", "link", "repo"] as const, n);
  return [...new Set(kinds)].map((kind) => {
    switch (kind) {
      case "error":
        return { kind, text: chance(r, 0.6) && SERVICE_ERRORS[s.id] ? pick(r, SERVICE_ERRORS[s.id]) : pick(r, GENERIC_ERRORS) };
      case "ticket":
        return { kind, text: ticketFor(r, s.team) };
      case "dashboard":
        return { kind, text: dashboardFor(r, s) };
      case "link":
        return { kind, text: linkFor(r, s) };
      case "repo":
        return { kind, text: s.repo };
    }
  });
}

const FIRST = ["dana", "li", "omar", "priya", "tomas", "keiko", "sam", "ines", "noah", "amara"];
const LAST = ["ruiz", "chen", "haddad", "nair", "novak", "sato", "porter", "silva", "berg", "okafor"];
const PERSONAL_TOPICS = [
  "a medical appointment",
  "their visa or immigration status",
  "their salary or compensation",
  "a performance review",
  "a harassment complaint they filed",
  "therapy sessions",
  "a pregnancy",
  "a family member's illness",
  "sick leave",
  "a disability accommodation",
];

function sensitiveItem(r: () => number): SensitiveItem {
  const kind = pick(r, ["email", "phone", "credential", "credential", "customer_data", "personal", "personal", "personal"] as const);
  const name = `${pick(r, FIRST)}.${pick(r, LAST)}`;
  switch (kind) {
    case "email":
      return { kind, why: "email address", text: `${name}@${pick(r, ["ferndale.example", "gmail.example", "shipper.example"])}`, topic: null };
    case "phone":
      return { kind, why: "phone number", text: `+1 ${pick(r, ["415", "212", "646", "312"])} 555 0${100 + Math.floor(r() * 899)}`, topic: null };
    case "credential": {
      const hex = () => Math.floor(r() * 0xffffffff).toString(16).padStart(8, "0");
      const text = pick(r, [
        `sk_test_${hex()}${hex()}`,
        `AKIA${hex().toUpperCase()}${hex().toUpperCase()}`,
        `password is Fern${hex().slice(0, 5)}!`,
        `token=${hex()}${hex()}${hex()}`,
      ]);
      return { kind, why: "credential", text, topic: null };
    }
    case "customer_data":
      return { kind, why: "customer personal data", text: `${pick(r, ["Maria", "John", "Aisha", "Wei", "Lucas"])} ${pick(r, ["Gomez", "Keller", "Bello", "Tan", "Moreau"])}, ${10 + Math.floor(r() * 990)} ${pick(r, ["Elm", "Harbor", "Mill", "Cedar"])} St`, topic: null };
    case "personal": {
      const topic = pick(r, PERSONAL_TOPICS);
      return { kind, why: `personal or HR matter (${topic.replace(/^(a|their|an) /, "")})`, text: null, topic };
    }
  }
}

function helpKind(r: () => number): HelpKind {
  // unblock is the most common shape of a new hire's question.
  return pick(r, ["unblock", "unblock", "unblock", "how_works", "how_works", "where_is", "where_is", "is_expected", "who_decides"] as const satisfies readonly (typeof HELP_KINDS)[number][]);
}
function urgency(r: () => number): Urgency {
  return pick(r, [null, null, null, "blocked_now", "blocked_today", "blocked_today", "curious"] as const);
}

function skillsFor(r: () => number, services: CatalogService[], skills: CatalogSkill[], max: number) {
  const pool = [...new Set(services.flatMap((s) => s.skillIds))];
  const n = Math.min(max, Math.floor(r() * (max + 1)));
  return sample(r, pool, n).flatMap((id) => {
    const k = skills.find((x) => x.id === id);
    return k ? [{ id: k.id, name: k.name }] : [];
  });
}

const svcOut = (s: CatalogService) => ({ id: s.id, name: s.name, repo: s.repo, description: s.description });

export function makeSpec(r: () => number, id: string, category: Category, all: { services: CatalogService[]; skills: CatalogSkill[] }, holdout: boolean): Spec {
  const allowed = all.services.filter((s) => (HOLDOUT_SERVICES as readonly string[]).includes(s.id) === holdout);
  let services: CatalogService[] = [];
  let maxSkills = 2;
  let nArtifacts = Math.floor(r() * 3);
  let sens: SensitiveItem[] = [];
  let namesAllowed = true;
  let language = "English";
  switch (category) {
    case "clear":
      services = [pick(r, allowed)];
      break;
    case "vague":
      // Half name nothing at all (the honest answer is no service); half name one service and little else.
      services = chance(r, 0.5) && !holdout ? [] : [pick(r, allowed)];
      maxSkills = services.length ? 1 : 0;
      nArtifacts = 0;
      break;
    case "no_vocab":
      services = [pick(r, allowed)];
      maxSkills = 1;
      namesAllowed = false;
      nArtifacts = chance(r, 0.4) ? 1 : 0;
      break;
    case "two_problems": {
      const a = pick(r, allowed);
      const b = pick(r, all.services.filter((s) => s.id !== a.id && (!(HOLDOUT_SERVICES as readonly string[]).includes(s.id) || holdout)));
      services = [a, b];
      maxSkills = 3;
      nArtifacts = 1 + Math.floor(r() * 2);
      break;
    }
    case "sensitive":
      services = chance(r, 0.85) ? [pick(r, allowed)] : [];
      sens = chance(r, 0.25) ? [sensitiveItem(r), sensitiveItem(r)] : [sensitiveItem(r)];
      break;
    case "second_language":
      services = [pick(r, allowed)];
      language = pick(r, LANGUAGES);
      if (chance(r, 0.15)) sens = [sensitiveItem(r)];
      break;
  }
  // A few sensitive spans everywhere, so the model never learns "sensitive only in that category".
  if (category !== "sensitive" && category !== "vague" && !sens.length && chance(r, 0.06)) sens = [sensitiveItem(r)];
  const artifacts = services.length ? services.flatMap((s, i) => artifactsFor(r, s, i === 0 ? nArtifacts : Math.min(1, nArtifacts))) : [];
  // Two of the same text (same generic error picked twice) would make the label ambiguous.
  const uniq = artifacts.filter((a, i) => artifacts.findIndex((b) => b.text === a.text) === i);
  if (sens.filter((s) => s.kind === "personal").length > 1) sens = sens.filter((s, i) => s.kind !== "personal" || sens.findIndex((x) => x.kind === "personal") === i);
  return {
    id,
    category,
    holdout,
    services: services.map(svcOut),
    skills: skillsFor(r, services, all.skills, maxSkills),
    helpKind: services.length || category !== "vague" ? helpKind(r) : pick(r, ["how_works", "where_is", "who_decides"] as const),
    urgency: urgency(r),
    artifacts: uniq,
    sensitive: sens,
    namesAllowed,
    language,
    style: pick(r, STYLES),
  };
}

/** How many of each category to generate. Extra over the targets covers rejected generations. */
export const PLAN = {
  main: { clear: 900, vague: 450, no_vocab: 650, two_problems: 500, sensitive: 550, second_language: 500 } satisfies Record<Category, number>,
  /** Held-out services: eval only. */
  holdout: { clear: 30, vague: 10, no_vocab: 30, two_problems: 15, sensitive: 15, second_language: 15 } satisfies Record<Category, number>,
  /** The 300-example test set: 50 per category. */
  testPerCategory: 50,
};

export function buildSpecs(seed: string, all: { services: CatalogService[]; skills: CatalogSkill[] }): Spec[] {
  const r = rng(seed);
  const out: Spec[] = [];
  let n = 0;
  for (const [set, plan] of [["main", PLAN.main], ["holdout", PLAN.holdout]] as const)
    for (const c of CATEGORIES) for (let i = 0; i < plan[c]; i++) out.push(makeSpec(r, `${set === "main" ? "u" : "h"}${String(++n).padStart(5, "0")}`, c, all, set === "holdout"));
  return out;
}
