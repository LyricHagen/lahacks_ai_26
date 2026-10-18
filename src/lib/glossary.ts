// Ferndale's internal jargon: the nicknames people use for services and the freight terms a new
// hire has not learned yet. A new hire writes "the till double charged after the WH secret rotated"
// and means billing-service and its Stripe webhook signing secret; no service name appears, so the
// catalog matcher finds nothing. The glossary agent (resolve_jargon: CREAO when FEATURE_CREAO_GLOSSARY
// is on, resolveJargonLocally in demo mode) reads the ask against this table before retrieval, and
// every hit adds its services and skills to the understanding and its meaning to the search text.
//
// Grounding: an entry may only point at real catalog ids (pnpm glossary:check verifies them), and
// the agent may only answer with entry ids from this table, never a service or skill of its own.
// No server imports: the confirm panel shows the same entries.

import { findTerm } from "./understanding";

export type GlossaryEntry = {
  id: string;
  /** How the term is usually written. */
  term: string;
  /** Other spellings people use. Matched whole word, like catalog names. */
  aliases: string[];
  /** One plain sentence, shown on the confirm screen and added to the search text. */
  means: string;
  serviceIds: string[];
  skillIds: string[];
};

export const GLOSSARY: GlossaryEntry[] = [
  { id: "glo_till", term: "the till", aliases: [], means: "Ferndale's name for billing-service, which charges shippers and applies credits.", serviceIds: ["svc_billing"], skillIds: ["skl_payments"] },
  { id: "glo_wh_secret", term: "WH secret", aliases: ["webhook secret", "whsec", "hook secret"], means: "The Stripe webhook signing secret billing-service checks on every Stripe event.", serviceIds: ["svc_billing", "svc_secrets"], skillIds: ["skl_stripe_api", "skl_secrets"] },
  { id: "glo_paperboy", term: "Paperboy", aliases: ["paper boy"], means: "invoice-worker, which renders monthly invoices to PDF and emails them to finance contacts.", serviceIds: ["svc_invoicing"], skillIds: ["skl_invoicing"] },
  { id: "glo_conveyor", term: "Conveyor", aliases: ["the conveyor", "conveyer"], means: "ingest-pipeline, the Kafka consumers and Airflow jobs that load product events into the warehouse.", serviceIds: ["svc_ingest"], skillIds: ["skl_kafka", "skl_airflow"] },
  { id: "glo_firehose", term: "the firehose", aliases: ["firehose"], means: "The raw product event topics in Kafka that ingest-pipeline consumes.", serviceIds: ["svc_ingest"], skillIds: ["skl_kafka"] },
  { id: "glo_dlq", term: "DLQ", aliases: ["dead letter queue", "dead-letter queue"], means: "A dead letter queue: Kafka messages a consumer gave up on, kept for replay.", serviceIds: [], skillIds: ["skl_kafka"] },
  { id: "glo_edi214", term: "EDI 214", aliases: ["214s", "214 feed", "carrier status feed"], means: "Carrier shipment status updates, loaded through ingest-pipeline.", serviceIds: ["svc_ingest"], skillIds: [] },
  { id: "glo_foundry", term: "Foundry", aliases: ["the foundry"], means: "build-pipeline: CI runners, build caching and deploys for every backend service.", serviceIds: ["svc_build"], skillIds: ["skl_ci_cd"] },
  { id: "glo_red_main", term: "red main", aliases: ["main is red", "red build"], means: "A failing build on the main branch in build-pipeline.", serviceIds: ["svc_build"], skillIds: ["skl_ci_cd"] },
  { id: "glo_yard", term: "the yard", aliases: ["yard cluster"], means: "k8s-platform, the production and staging Kubernetes clusters.", serviceIds: ["svc_k8s"], skillIds: ["skl_kubernetes"] },
  { id: "glo_dockside", term: "Dockside", aliases: ["dock side"], means: "mobile-ci, which builds, signs and ships the iOS and Android apps.", serviceIds: ["svc_mobile_build"], skillIds: ["skl_ios_release", "skl_android_release"] },
  { id: "glo_lighthouse", term: "Lighthouse", aliases: ["light house"], means: "observability: metrics, logs, traces and alerting.", serviceIds: ["svc_observability"], skillIds: ["skl_observability"] },
  { id: "glo_klaxon", term: "Klaxon", aliases: ["the klaxon"], means: "incident-bot: on-call schedules, paging and the incident chat bot.", serviceIds: ["svc_incident"], skillIds: ["skl_incident_response"] },
  { id: "glo_p1", term: "P1", aliases: ["sev1", "sev 1"], means: "A priority one incident, which pages on-call through incident-bot.", serviceIds: ["svc_incident"], skillIds: ["skl_incident_response"] },
  { id: "glo_lockbox", term: "the lockbox", aliases: ["lockbox"], means: "vault-config: secrets storage, rotation policies and service credentials.", serviceIds: ["svc_secrets"], skillIds: ["skl_secrets"] },
  { id: "glo_front_door", term: "the front door", aliases: [], means: "auth-gateway: login, SSO and session tokens for every app.", serviceIds: ["svc_auth"], skillIds: ["skl_oauth_sso"] },
  { id: "glo_turnstile", term: "Turnstile", aliases: ["the turnstile"], means: "access-review: access requests, approvals and quarterly reviews.", serviceIds: ["svc_access"], skillIds: ["skl_access_reviews"] },
  { id: "glo_scoreboard", term: "the scoreboard", aliases: [], means: "bi-dashboards, the company KPI dashboards and metrics layer.", serviceIds: ["svc_dashboards"], skillIds: ["skl_dashboards"] },
  { id: "glo_switchboard", term: "Switchboard", aliases: ["the switchboard"], means: "flagd, which serves feature flags and A/B experiment assignment.", serviceIds: ["svc_flags"], skillIds: ["skl_feature_flags", "skl_experimentation"] },
  { id: "glo_postmaster", term: "Postmaster", aliases: ["post master"], means: "lifecycle-mail: transactional and lifecycle email delivery.", serviceIds: ["svc_email"], skillIds: ["skl_email_delivery"] },
  { id: "glo_compass", term: "Compass", aliases: [], means: "search-ranker, which ranks search results across shipments, invoices and documents.", serviceIds: ["svc_search"], skillIds: ["skl_search_ranking", "skl_elasticsearch"] },
  { id: "glo_nudge", term: "Nudge", aliases: ["Nudges"], means: "recs-service, which suggests next actions and related records.", serviceIds: ["svc_recs"], skillIds: ["skl_recommendations"] },
  { id: "glo_beacon", term: "Beacon", aliases: [], means: "push-notify, which sends push notifications through APNs and FCM.", serviceIds: ["svc_push"], skillIds: ["skl_push"] },
  { id: "glo_passport", term: "Passport", aliases: [], means: "profile-api: user and organization profiles, roles and permissions.", serviceIds: ["svc_profiles"], skillIds: ["skl_permissions"] },
  { id: "glo_cellar", term: "the cellar", aliases: [], means: "warehouse: warehouse schemas, dbt models and access grants.", serviceIds: ["svc_warehouse"], skillIds: ["skl_dbt", "skl_data_modeling"] },
  { id: "glo_relay", term: "Relay", aliases: [], means: "helpdesk-bridge, which syncs support tickets and escalates bugs to engineering.", serviceIds: ["svc_helpdesk"], skillIds: ["skl_helpdesk", "skl_escalations"] },
  { id: "glo_bricks", term: "Bricks", aliases: [], means: "ui-kit, the shared React components and design tokens.", serviceIds: ["svc_ui_kit"], skillIds: ["skl_design_systems", "skl_react"] },
  { id: "glo_welcome_mat", term: "the welcome mat", aliases: [], means: "onboarding-portal: new hire checklists, documents and benefits enrollment.", serviceIds: ["svc_onboarding_portal"], skillIds: ["skl_onboarding_programs"] },
  { id: "glo_shoebox", term: "the shoebox", aliases: [], means: "expense-sync: corporate cards, expense reports and reimbursements.", serviceIds: ["svc_expenses"], skillIds: ["skl_expense_policy"] },
  { id: "glo_depot", term: "the depot", aliases: [], means: "mdm-config: laptop provisioning, MDM profiles and VPN.", serviceIds: ["svc_devices"], skillIds: ["skl_device_management", "skl_networking"] },
  { id: "glo_waybill", term: "Waybill", aliases: ["the waybill app", "waybill app"], means: "web, the shipper-facing web application.", serviceIds: ["svc_web_app"], skillIds: ["skl_react", "skl_typescript"] },
  { id: "glo_bol", term: "BOL", aliases: ["bill of lading", "BOLs"], means: "A bill of lading: the shipment document shippers see and download in the web app.", serviceIds: ["svc_web_app"], skillIds: [] },
  { id: "glo_ltl", term: "LTL", aliases: ["less than truckload"], means: "Less than truckload: a shipment that shares a truck with others.", serviceIds: [], skillIds: [] },
];

export const GLOSSARY_VERSION = "ferndale-glossary-v1";

export type JargonHit = {
  /** The words as they appear in the ask. */
  phrase: string;
  glossaryId: string;
  term: string;
  means: string;
  serviceIds: string[];
  skillIds: string[];
  confidence: "high" | "medium";
};

/** What resolve_jargon returns, live (the CREAO agent) or from resolveJargonLocally. */
export type JargonResult = { hits: JargonHit[]; unknown: string[] };

/** Stored on the understanding (asks.understanding.glossary). */
export type GlossaryReading = JargonResult & {
  via: "creao" | "recorded" | "local";
  /** "Cached demo result: ..." when not live. */
  note: string | null;
  ms: number;
};

export function entryById(id: string): GlossaryEntry | undefined {
  return GLOSSARY.find((g) => g.id === id);
}

export function hitFor(e: GlossaryEntry, phrase: string, confidence: JargonHit["confidence"]): JargonHit {
  return { phrase, glossaryId: e.id, term: e.term, means: e.means, serviceIds: e.serviceIds, skillIds: e.skillIds, confidence };
}

/**
 * A single capitalised nickname ("Relay", "Compass") matches only capitalised, so the ordinary word
 * ("relay the message") does not count; everything else matches like a catalog name (findTerm).
 */
export function matchesWord(text: string, w: string): boolean {
  if (/^[A-Z][a-z]/.test(w) && !w.includes(" ")) return new RegExp(`(^|[^A-Za-z0-9_])${w}($|[^A-Za-z0-9_])`).test(text);
  return findTerm(text, w);
}

/** Where a phrase sits in the text, ignoring case, or -1. */
export function phraseAt(text: string, phrase: string): number {
  return text.toLowerCase().indexOf(phrase.toLowerCase());
}

/**
 * Exact whole-word matches of each term and alias. Deterministic, offline: the demo result for
 * resolve_jargon. It cannot read misspellings, plurals it was not given or paraphrases, which is
 * the work the live agent does.
 */
export function resolveJargonLocally(text: string): JargonResult {
  const hits: JargonHit[] = [];
  for (const e of GLOSSARY) {
    const found = [e.term, ...e.aliases].find((w) => matchesWord(text, w));
    if (!found) continue;
    const at = phraseAt(text, found);
    hits.push(hitFor(e, at >= 0 ? text.slice(at, at + found.length) : found, "high"));
  }
  return { hits, unknown: [] };
}

/** The meanings of the hits, appended to the text the similarity search embeds. */
export function glossarySearchText(g: GlossaryReading | null | undefined): string {
  return g?.hits.map((h) => `${h.term}: ${h.means}`).join("\n") ?? "";
}
