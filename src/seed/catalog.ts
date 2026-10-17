// Hand-authored structure of the synthetic company, Corvid Systems.
//
// The generator (src/seed/generate.ts) fills these slots with people chosen by the seed string,
// so a different seed changes names, tenures and calendars but keeps the structure the ranking
// needs: one primary and one secondary owner per service, the planted decoys, the overloaded
// seniors, the unavailable owners and the questions that a document already answers.

import type { Zone } from "@/lib/time";

export const ORG = {
  id: "org_corvid",
  name: "Corvid Systems",
  domain: "corvid.example",
  description:
    "Corvid builds freight software: shippers book loads, track shipments and pay carriers in one place. About 200 people across eight departments, in Pacific, Eastern and London time.",
};

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export type SkillDef = { id: string; name: string; category: "language" | "platform" | "domain" | "practice" | "business"; aliases: string[] };

const s = (id: string, name: string, category: SkillDef["category"], aliases: string[] = []): SkillDef => ({ id: `skl_${id}`, name, category, aliases });

export const SKILLS: SkillDef[] = [
  s("typescript", "TypeScript", "language", ["ts", "javascript", "node"]),
  s("go", "Go", "language", ["golang"]),
  s("python", "Python", "language", ["py"]),
  s("kotlin", "Kotlin", "language", ["android"]),
  s("swift", "Swift", "language", ["ios"]),
  s("sql", "SQL", "language", ["queries"]),
  s("kubernetes", "Kubernetes", "platform", ["k8s", "kube", "kubectl", "helm", "pods"]),
  s("terraform", "Terraform", "platform", ["iac", "infrastructure as code"]),
  s("ci_cd", "CI/CD pipelines", "platform", ["ci", "build pipeline", "deploys", "github actions"]),
  s("observability", "Observability", "platform", ["metrics", "prometheus", "grafana", "tracing", "alerts"]),
  s("postgres", "Postgres", "platform", ["postgresql", "database", "db"]),
  s("redis", "Redis", "platform", ["cache"]),
  s("kafka", "Kafka", "platform", ["event streaming", "consumers", "topics"]),
  s("airflow", "Airflow", "platform", ["dags", "scheduler"]),
  s("dbt", "dbt", "platform", ["data models", "transformations"]),
  s("spark", "Spark", "platform", ["pyspark", "batch jobs"]),
  s("elasticsearch", "Elasticsearch", "platform", ["search index", "opensearch"]),
  s("react", "React", "platform", ["frontend", "jsx"]),
  s("react_native", "React Native", "platform", ["mobile js"]),
  s("graphql", "GraphQL", "platform", ["schema", "resolvers"]),
  s("ios_release", "iOS release builds", "platform", ["xcode", "fastlane", "testflight", "code signing"]),
  s("android_release", "Android release builds", "platform", ["gradle", "play console"]),
  s("push", "Push notifications", "platform", ["apns", "fcm"]),
  s("feature_flags", "Feature flags", "platform", ["flags", "rollouts", "toggles"]),
  s("email_delivery", "Email delivery", "platform", ["smtp", "deliverability", "templates"]),
  s("secrets", "Secrets management", "platform", ["vault", "credentials", "rotation"]),
  s("payments", "Payments", "domain", ["charges", "refunds", "billing"]),
  s("stripe_api", "Stripe API", "domain", ["stripe", "webhooks"]),
  s("invoicing", "Invoicing", "domain", ["invoices", "pdf invoices"]),
  s("oauth_sso", "OAuth and SSO", "domain", ["oauth", "saml", "oidc", "sso", "login"]),
  s("permissions", "Roles and permissions", "domain", ["rbac", "authorization"]),
  s("search_ranking", "Search ranking", "domain", ["relevance", "learning to rank"]),
  s("recommendations", "Recommendations", "domain", ["recs", "suggestions"]),
  s("data_modeling", "Data modeling", "domain", ["schemas", "warehouse design"]),
  s("experimentation", "Experimentation", "practice", ["a/b testing", "experiments"]),
  s("incident_response", "Incident response", "practice", ["on-call", "incidents", "paging"]),
  s("access_reviews", "Access reviews", "practice", ["iam", "access requests"]),
  s("threat_modeling", "Threat modeling", "practice", ["security review"]),
  s("design_systems", "Design systems", "practice", ["components", "design tokens"]),
  s("accessibility", "Accessibility", "practice", ["a11y", "wcag", "screen readers"]),
  s("figma", "Figma", "practice", ["mockups", "prototypes"]),
  s("user_research", "User research", "practice", ["interviews", "usability tests"]),
  s("product_analytics", "Product analytics", "practice", ["funnels", "retention"]),
  s("dashboards", "Dashboards", "practice", ["looker", "bi", "reports"]),
  s("roadmapping", "Roadmapping", "practice", ["planning", "prioritization"]),
  s("tech_writing", "Technical writing", "practice", ["docs", "runbooks"]),
  s("escalations", "Customer escalations", "business", ["escalation", "enterprise customers"]),
  s("helpdesk", "Helpdesk tooling", "business", ["zendesk", "tickets", "macros"]),
  s("onboarding_programs", "Onboarding programs", "business", ["new hire onboarding", "orientation"]),
  s("recruiting", "Recruiting", "business", ["hiring", "interviews"]),
  s("expense_policy", "Expense policy", "business", ["expenses", "reimbursements", "corporate card"]),
  s("device_management", "Device management", "business", ["mdm", "laptops", "provisioning"]),
  s("networking", "Network and VPN", "business", ["vpn", "wifi", "dns"]),
];

// ---------------------------------------------------------------------------
// Departments and teams
// ---------------------------------------------------------------------------

export type Track = "swe" | "mobile" | "sre" | "data" | "ml" | "analyst" | "security" | "pm" | "design" | "research" | "support" | "csm" | "it" | "people" | "finance";

export const DEPARTMENTS = [
  { key: "engineering", name: "Engineering", headTitle: "VP of Engineering", headTrack: "swe" as Track },
  { key: "infrastructure", name: "Infrastructure", headTitle: "Head of Infrastructure", headTrack: "sre" as Track },
  { key: "data", name: "Data", headTitle: "Head of Data", headTrack: "data" as Track },
  { key: "security", name: "Security", headTitle: "Head of Security", headTrack: "security" as Track },
  { key: "product", name: "Product", headTitle: "VP of Product", headTrack: "pm" as Track },
  { key: "design", name: "Design", headTitle: "Head of Design", headTrack: "design" as Track },
  { key: "support", name: "Customer Support", headTitle: "VP of Customer Support", headTrack: "support" as Track },
  { key: "operations", name: "Operations", headTitle: "VP of Operations", headTrack: "people" as Track },
] as const;

export type DeptKey = (typeof DEPARTMENTS)[number]["key"];

export type TeamDef = {
  key: string;
  name: string;
  dept: DeptKey;
  track: Track;
  /** Individual contributors, not counting the manager or planted people. */
  size: number;
  tz: Partial<Record<Zone, number>>;
  core: string[];
  adjacent: string[];
};

const LA: Zone = "America/Los_Angeles";
const NY: Zone = "America/New_York";
const LDN: Zone = "Europe/London";

export const TEAMS: TeamDef[] = [
  { key: "payments", name: "Payments", dept: "engineering", track: "swe", size: 10, tz: { [LA]: 6, [NY]: 4 }, core: ["go", "payments", "stripe_api", "postgres", "invoicing"], adjacent: ["kafka", "redis", "observability", "typescript"] },
  { key: "identity", name: "Identity", dept: "engineering", track: "swe", size: 9, tz: { [LA]: 4, [NY]: 3, [LDN]: 3 }, core: ["go", "oauth_sso", "permissions", "postgres"], adjacent: ["redis", "secrets", "typescript"] },
  { key: "mobile", name: "Mobile", dept: "engineering", track: "mobile", size: 8, tz: { [LA]: 7, [NY]: 3 }, core: ["swift", "kotlin", "react_native", "ios_release", "android_release"], adjacent: ["push", "ci_cd", "typescript"] },
  { key: "web", name: "Web", dept: "engineering", track: "swe", size: 12, tz: { [LA]: 5, [NY]: 5 }, core: ["typescript", "react", "graphql", "accessibility"], adjacent: ["design_systems", "feature_flags", "ci_cd"] },
  { key: "growth", name: "Growth", dept: "engineering", track: "swe", size: 9, tz: { [LA]: 5, [NY]: 5 }, core: ["typescript", "feature_flags", "experimentation", "email_delivery"], adjacent: ["product_analytics", "react", "sql"] },
  { key: "platform", name: "Platform", dept: "infrastructure", track: "sre", size: 11, tz: { [LA]: 4, [NY]: 2, [LDN]: 4 }, core: ["kubernetes", "terraform", "ci_cd", "go"], adjacent: ["observability", "secrets", "postgres"] },
  { key: "reliability", name: "Reliability", dept: "infrastructure", track: "sre", size: 8, tz: { [LA]: 3, [NY]: 3, [LDN]: 4 }, core: ["observability", "incident_response", "kubernetes", "go"], adjacent: ["terraform", "postgres", "python"] },
  { key: "data_eng", name: "Data Engineering", dept: "data", track: "data", size: 9, tz: { [NY]: 7, [LA]: 3 }, core: ["python", "kafka", "airflow", "sql", "dbt"], adjacent: ["spark", "data_modeling", "postgres"] },
  { key: "ml", name: "Machine Learning", dept: "data", track: "ml", size: 8, tz: { [NY]: 5, [LA]: 5 }, core: ["python", "search_ranking", "recommendations", "elasticsearch"], adjacent: ["spark", "sql", "experimentation"] },
  { key: "analytics", name: "Analytics", dept: "data", track: "analyst", size: 8, tz: { [NY]: 7, [LA]: 3 }, core: ["sql", "dashboards", "product_analytics", "dbt"], adjacent: ["python", "experimentation", "data_modeling"] },
  { key: "appsec", name: "Application Security", dept: "security", track: "security", size: 6, tz: { [NY]: 4, [LDN]: 6 }, core: ["threat_modeling", "secrets", "access_reviews", "go"], adjacent: ["oauth_sso", "kubernetes", "python"] },
  { key: "product_mgmt", name: "Product Management", dept: "product", track: "pm", size: 10, tz: { [LA]: 5, [NY]: 5 }, core: ["roadmapping", "product_analytics", "user_research"], adjacent: ["experimentation", "sql", "tech_writing"] },
  { key: "product_design", name: "Product Design", dept: "design", track: "design", size: 8, tz: { [LA]: 6, [NY]: 4 }, core: ["figma", "design_systems", "accessibility"], adjacent: ["user_research", "react", "tech_writing"] },
  { key: "ux_research", name: "UX Research", dept: "design", track: "research", size: 3, tz: { [LA]: 5, [NY]: 5 }, core: ["user_research", "product_analytics"], adjacent: ["figma", "sql"] },
  { key: "support_eng", name: "Support Engineering", dept: "support", track: "support", size: 9, tz: { [NY]: 5, [LA]: 3, [LDN]: 2 }, core: ["escalations", "helpdesk", "sql"], adjacent: ["python", "tech_writing", "oauth_sso"] },
  { key: "customer_success", name: "Customer Success", dept: "support", track: "csm", size: 13, tz: { [NY]: 5, [LA]: 3, [LDN]: 2 }, core: ["escalations", "onboarding_programs"], adjacent: ["helpdesk", "dashboards", "product_analytics"] },
  { key: "it", name: "IT", dept: "operations", track: "it", size: 6, tz: { [LA]: 6, [NY]: 4 }, core: ["device_management", "networking", "access_reviews"], adjacent: ["python", "secrets"] },
  { key: "people", name: "People", dept: "operations", track: "people", size: 6, tz: { [LA]: 5, [NY]: 5 }, core: ["onboarding_programs", "recruiting"], adjacent: ["tech_writing", "dashboards"] },
  { key: "finance", name: "Finance", dept: "operations", track: "finance", size: 6, tz: { [NY]: 7, [LA]: 3 }, core: ["expense_policy", "sql", "dashboards"], adjacent: ["invoicing", "payments"] },
];

/** Titles by track for junior, mid, senior, staff, principal ICs, then the team manager. */
export const TITLES: Record<Track, [string, string, string, string, string, string]> = {
  swe: ["Software Engineer I", "Software Engineer II", "Senior Software Engineer", "Staff Software Engineer", "Principal Engineer", "Engineering Manager"],
  mobile: ["Mobile Engineer I", "Mobile Engineer II", "Senior Mobile Engineer", "Staff Mobile Engineer", "Principal Mobile Engineer", "Engineering Manager, Mobile"],
  sre: ["Site Reliability Engineer I", "Site Reliability Engineer II", "Senior Site Reliability Engineer", "Staff Site Reliability Engineer", "Principal Site Reliability Engineer", "Engineering Manager, Infrastructure"],
  data: ["Data Engineer I", "Data Engineer II", "Senior Data Engineer", "Staff Data Engineer", "Principal Data Engineer", "Data Engineering Manager"],
  ml: ["Machine Learning Engineer I", "Machine Learning Engineer II", "Senior Machine Learning Engineer", "Staff Machine Learning Engineer", "Principal Machine Learning Engineer", "Machine Learning Manager"],
  analyst: ["Data Analyst", "Data Analyst II", "Senior Data Analyst", "Staff Data Analyst", "Principal Data Analyst", "Analytics Manager"],
  security: ["Security Engineer I", "Security Engineer II", "Senior Security Engineer", "Staff Security Engineer", "Principal Security Engineer", "Security Engineering Manager"],
  pm: ["Associate Product Manager", "Product Manager", "Senior Product Manager", "Group Product Manager", "Principal Product Manager", "Director of Product"],
  design: ["Product Designer I", "Product Designer II", "Senior Product Designer", "Staff Product Designer", "Principal Designer", "Design Manager"],
  research: ["UX Researcher", "UX Researcher II", "Senior UX Researcher", "Staff UX Researcher", "Principal UX Researcher", "Research Manager"],
  support: ["Support Engineer I", "Support Engineer II", "Senior Support Engineer", "Staff Support Engineer", "Principal Support Engineer", "Support Engineering Manager"],
  csm: ["Customer Success Associate", "Customer Success Manager", "Senior Customer Success Manager", "Principal Customer Success Manager", "Principal Customer Success Manager", "Customer Success Lead"],
  it: ["IT Support Specialist", "IT Engineer", "Senior IT Engineer", "Staff IT Engineer", "Principal IT Engineer", "IT Manager"],
  people: ["People Operations Coordinator", "People Partner", "Senior People Partner", "Staff People Partner", "Principal People Partner", "People Operations Manager"],
  finance: ["Accounting Associate", "Financial Analyst", "Senior Financial Analyst", "Staff Financial Analyst", "Principal Financial Analyst", "Controller"],
};

// ---------------------------------------------------------------------------
// Planted people. Each is a slot the generator fills with a seeded name.
// ---------------------------------------------------------------------------

export type PlantedKind = "overloaded" | "decoy" | "unavailable" | "new_hire";

export type PlantedDef = {
  key: string;
  kind: PlantedKind;
  team: string;
  level: 0 | 1 | 2 | 3 | 4;
  /** Override the track title. */
  title?: string;
  /** For decoys: the skill they list without ever touching the service that needs it. */
  decoySkills?: { skillId: string; proficiency: number; evidence: string }[];
  /** A sentence the bio must contain (decoys lean hard on the keyword; overloaded people are named in everything). */
  bioHook?: string;
  calendar?: { oooFrom?: number; oooTo?: number; oooTitle?: string; fullyBookedDays?: number; heavy?: boolean };
  /** Days since start, negative means started that many days ago. */
  startDayOffset?: number;
  timezone?: Zone;
};

export const PLANTED: PlantedDef[] = [
  // Overloaded: senior, highly skilled, named in everything. Load balancing must route around them.
  {
    key: "over_payments",
    kind: "overloaded",
    team: "payments",
    level: 4,
    bioHook: "Wrote most of the original billing code and is still the first name people mention for anything involving money, invoices or Stripe.",
    calendar: { heavy: true },
    timezone: LA,
  },
  {
    key: "over_sre",
    kind: "overloaded",
    team: "reliability",
    level: 3,
    bioHook: "Has been on the escalation path for nearly every major incident since 2022 and is the person everyone pings when a dashboard turns red.",
    calendar: { heavy: true },
    timezone: NY,
  },
  {
    key: "over_data",
    kind: "overloaded",
    team: "data_eng",
    level: 3,
    bioHook: "Built the first version of the ingest pipeline and the warehouse, so most data questions eventually land in their inbox.",
    calendar: { heavy: true },
    timezone: NY,
  },
  {
    key: "over_mobile",
    kind: "overloaded",
    team: "mobile",
    level: 3,
    bioHook: "Set up the mobile release process from scratch and is still the only person who has shipped every single app release.",
    calendar: { heavy: true },
    timezone: LA,
  },

  // Decoys: the profile lists the keyword, but they have never touched the service.
  {
    key: "decoy_stripe",
    kind: "decoy",
    team: "web",
    level: 1,
    decoySkills: [
      { skillId: "skl_stripe_api", proficiency: 4, evidence: "Listed in their profile from a side project; they have never committed to billing-service." },
      { skillId: "skl_payments", proficiency: 3, evidence: "Listed in their profile; no payments work at Corvid so far." },
    ],
    bioHook: "Built a Stripe checkout and Stripe webhooks for a side project and lists Stripe API and payments in their profile.",
  },
  {
    key: "decoy_kafka",
    kind: "decoy",
    team: "growth",
    level: 2,
    decoySkills: [{ skillId: "skl_kafka", proficiency: 4, evidence: "Listed in their profile from a previous job running Kafka consumers; they have not worked on the ingest pipeline." }],
    bioHook: "Ran Kafka consumers and Kafka topics at a previous company and still lists Kafka as a top skill.",
  },
  {
    key: "decoy_k8s",
    kind: "decoy",
    team: "ml",
    level: 1,
    decoySkills: [{ skillId: "skl_kubernetes", proficiency: 4, evidence: "Listed in their profile after a Kubernetes certification course; they have no access to the Corvid clusters." }],
    bioHook: "Recently passed a Kubernetes certification, runs a Kubernetes cluster at home for fun, and lists Kubernetes, kubectl, Helm and debugging pods in their profile.",
  },
  {
    key: "decoy_oauth",
    kind: "decoy",
    team: "support_eng",
    level: 2,
    decoySkills: [{ skillId: "skl_oauth_sso", proficiency: 4, evidence: "Listed in their profile; they wrote customer help articles about SSO setup but have never changed auth-gateway." }],
    bioHook: "Writes the customer help articles about SSO and SAML login setup and lists OAuth and SSO in their profile.",
  },
  {
    key: "decoy_ios",
    kind: "decoy",
    team: "web",
    level: 2,
    decoySkills: [
      { skillId: "skl_swift", proficiency: 4, evidence: "Listed in their profile from a hobby iOS app; no Swift work at Corvid." },
      { skillId: "skl_ios_release", proficiency: 3, evidence: "Listed in their profile; they publish a personal app with Xcode and fastlane but have never touched mobile-ci." },
    ],
    bioHook: "Publishes a personal iOS app with Xcode and fastlane on weekends and lists Swift and iOS release builds in their profile.",
  },

  // Unavailable owners: availability should change the answer.
  { key: "vac_auth", kind: "unavailable", team: "identity", level: 2, calendar: { oooFrom: 0, oooTo: 9, oooTitle: "Vacation" }, timezone: LA },
  { key: "booked_search", kind: "unavailable", team: "ml", level: 3, calendar: { fullyBookedDays: 8 }, timezone: NY },
  { key: "vac_finance", kind: "unavailable", team: "finance", level: 2, calendar: { oooFrom: 0, oooTo: 8, oooTitle: "Out of office" }, timezone: NY },

  // The default persona for the demo: a new hire on the Web team, ten days in.
  { key: "newhire_web", kind: "new_hire", team: "web", level: 0, startDayOffset: -10, timezone: LA },
];

// ---------------------------------------------------------------------------
// Services. Owner slots: "planted:<key>", "ic:<n>" (nth most senior non-planted IC on the team).
// ---------------------------------------------------------------------------

export type ServiceDef = {
  id: string;
  name: string;
  repo: string;
  team: string;
  description: string;
  skills: string[];
  primary: string;
  secondary: string;
};

const svc = (key: string, name: string, repo: string, team: string, description: string, skills: string[], primary: string, secondary: string): ServiceDef => ({
  id: `svc_${key}`,
  name,
  repo,
  team,
  description,
  skills: skills.map((k) => `skl_${k}`),
  primary,
  secondary,
});

export const SERVICES: ServiceDef[] = [
  svc("billing", "billing-service", "corvid/billing-service", "payments", "Charges shippers, applies credits and handles Stripe webhooks.", ["payments", "stripe_api", "go", "postgres"], "planted:over_payments", "ic:0"),
  svc("invoicing", "invoice-worker", "corvid/invoice-worker", "payments", "Renders monthly invoices to PDF and emails them to finance contacts.", ["invoicing", "go", "email_delivery"], "ic:1", "planted:over_payments"),
  svc("auth", "auth-gateway", "corvid/auth-gateway", "identity", "Login, SSO (SAML and OIDC), session tokens and password resets for every app.", ["oauth_sso", "go", "redis"], "planted:vac_auth", "ic:0"),
  svc("profiles", "profile-api", "corvid/profile-api", "identity", "User and organization profiles, roles and permissions.", ["permissions", "go", "postgres"], "ic:1", "ic:2"),
  svc("mobile_build", "mobile-ci", "corvid/mobile-ci", "mobile", "Builds, signs and ships the iOS and Android apps.", ["ios_release", "android_release", "ci_cd"], "planted:over_mobile", "ic:0"),
  svc("push", "push-notify", "corvid/push-notify", "mobile", "Sends push notifications through APNs and FCM.", ["push", "kotlin", "swift"], "ic:1", "planted:over_mobile"),
  svc("web_app", "web", "corvid/web", "web", "The shipper-facing web application.", ["typescript", "react", "graphql"], "ic:0", "ic:1"),
  svc("ui_kit", "ui-kit", "corvid/ui-kit", "web", "Shared React components and design tokens.", ["design_systems", "react", "accessibility"], "ic:2", "ic:3"),
  svc("flags", "flagd", "corvid/flagd", "growth", "Feature flags and A/B experiment assignment.", ["feature_flags", "experimentation", "typescript"], "ic:0", "ic:1"),
  svc("email", "lifecycle-mail", "corvid/lifecycle-mail", "growth", "Transactional and lifecycle email delivery and templates.", ["email_delivery", "typescript"], "ic:2", "ic:0"),
  svc("build", "build-pipeline", "corvid/build-pipeline", "platform", "CI runners, build caching and deploys for every backend service.", ["ci_cd", "go", "terraform"], "ic:0", "ic:1"),
  svc("k8s", "k8s-platform", "corvid/k8s-platform", "platform", "The production and staging Kubernetes clusters, Helm charts and namespaces.", ["kubernetes", "terraform"], "ic:1", "planted:over_sre"),
  svc("observability", "observability", "corvid/observability", "reliability", "Metrics, logs, traces and alerting.", ["observability", "go"], "ic:0", "planted:over_sre"),
  svc("incident", "incident-bot", "corvid/incident-bot", "reliability", "On-call schedules, paging and the incident chat bot.", ["incident_response", "python"], "planted:over_sre", "ic:1"),
  svc("ingest", "ingest-pipeline", "corvid/ingest-pipeline", "data_eng", "Kafka consumers and Airflow jobs that load product events into the warehouse.", ["kafka", "airflow", "python"], "planted:over_data", "ic:0"),
  svc("warehouse", "warehouse", "corvid/warehouse", "data_eng", "Warehouse schemas, dbt models and access grants.", ["dbt", "sql", "data_modeling"], "ic:1", "planted:over_data"),
  svc("search", "search-ranker", "corvid/search-ranker", "ml", "Ranks search results across shipments, invoices and documents.", ["search_ranking", "elasticsearch", "python"], "planted:booked_search", "ic:0"),
  svc("recs", "recs-service", "corvid/recs-service", "ml", "Suggests next actions and related records.", ["recommendations", "python"], "ic:1", "ic:0"),
  svc("dashboards", "bi-dashboards", "corvid/bi-dashboards", "analytics", "Company KPI dashboards and the metrics layer.", ["dashboards", "sql", "dbt"], "ic:0", "ic:1"),
  svc("secrets", "vault-config", "corvid/vault-config", "appsec", "Secrets storage, rotation policies and service credentials.", ["secrets", "terraform"], "ic:0", "ic:1"),
  svc("access", "access-review", "corvid/access-review", "appsec", "Access requests, approvals and quarterly reviews for production systems and data.", ["access_reviews", "permissions"], "ic:1", "ic:2"),
  svc("helpdesk", "helpdesk-bridge", "corvid/helpdesk-bridge", "support_eng", "Syncs support tickets with accounts and escalates bugs to engineering.", ["helpdesk", "python", "escalations"], "ic:0", "ic:1"),
  svc("devices", "mdm-config", "corvid/mdm-config", "it", "Laptop provisioning, MDM profiles and VPN.", ["device_management", "networking"], "ic:0", "ic:1"),
  svc("onboarding_portal", "onboarding-portal", "corvid/onboarding-portal", "people", "New hire checklists, documents and benefits enrollment.", ["onboarding_programs"], "ic:0", "ic:1"),
  svc("expenses", "expense-sync", "corvid/expense-sync", "finance", "Corporate cards, expense reports and reimbursements.", ["expense_policy", "sql"], "planted:vac_finance", "ic:0"),
];

// ---------------------------------------------------------------------------
// Projects (finished and active). Members are filled from the team plus the listed extras.
// ---------------------------------------------------------------------------

export type ProjectDef = {
  key: string;
  name: string;
  team: string;
  service: string | null;
  /** Days relative to the load day. */
  start: number;
  end: number | null;
  description: string;
  /** Extra members from other teams or planted slots, as "planted:<key>" or "team:<key>". */
  extras: string[];
};

const p = (key: string, name: string, team: string, service: string | null, start: number, end: number | null, description: string, extras: string[] = []): ProjectDef => ({
  key,
  name,
  team,
  service: service ? `svc_${service}` : null,
  start,
  end,
  description,
  extras,
});

export const PROJECTS: ProjectDef[] = [
  p("webhook_retries", "Webhook retries v2", "payments", "billing", -420, -300, "Made Stripe webhook handling idempotent and added a retry queue so duplicate events stop double charging.", ["planted:over_sre"]),
  p("carrier_payouts", "Carrier payouts", "payments", "billing", -120, null, "Pays carriers within 48 hours of delivery instead of net 30.", ["team:finance", "planted:over_data"]),
  p("invoice_pdf", "Invoice PDF rewrite", "payments", "invoicing", -260, -150, "Replaced the old invoice renderer with templated PDFs that finance can edit."),
  p("sso_enterprise", "Enterprise SSO", "identity", "auth", -300, -180, "Added SAML and OIDC single sign-on for enterprise shippers.", ["planted:over_payments", "team:appsec"]),
  p("session_hardening", "Session hardening", "identity", "auth", -90, null, "Shorter session lifetimes, refresh token rotation and device lists.", ["team:appsec"]),
  p("roles_v2", "Roles v2", "identity", "profiles", -200, -60, "Custom roles per organization, replacing three fixed roles.", ["team:product_mgmt"]),
  p("mobile_fastlane", "Release train", "mobile", "mobile_build", -360, -240, "Weekly mobile release train with automated signing and store uploads.", ["planted:over_sre"]),
  p("mobile_tracking", "Live tracking on mobile", "mobile", "push", -100, null, "Real-time shipment tracking with push updates for drivers and shippers.", ["team:ml"]),
  p("web_redesign", "Shipment page redesign", "web", "web_app", -150, -30, "Rebuilt the shipment detail page for speed and screen reader support.", ["team:product_design"]),
  p("ui_kit_tokens", "Design tokens", "web", "ui_kit", -80, null, "Moved colors, spacing and type into shared tokens used by web and mobile.", ["team:product_design"]),
  p("onboarding_flow", "Self-serve signup", "growth", "flags", -210, -120, "Let small shippers sign up and book a first load without a sales call.", ["team:product_mgmt", "planted:over_payments"]),
  p("lifecycle_emails", "Lifecycle email revamp", "growth", "email", -60, null, "New templates and send-time rules for onboarding and win-back emails."),
  p("ci_cache", "Remote build cache", "platform", "build", -330, -250, "Shared build cache that cut backend CI time roughly in half.", ["planted:over_sre"]),
  p("k8s_upgrade", "Cluster upgrade", "platform", "k8s", -70, null, "Upgrading both clusters two minor versions and moving to managed node pools.", ["planted:over_sre", "team:appsec"]),
  p("slo_rollout", "SLOs for every service", "reliability", "observability", -240, -90, "Defined SLOs and burn rate alerts for every tier one service.", ["planted:over_payments", "planted:over_data"]),
  p("oncall_bot", "Incident bot", "reliability", "incident", -400, -310, "Chat bot that opens incident channels, pages owners and drafts timelines."),
  p("events_v2", "Events pipeline v2", "data_eng", "ingest", -280, -100, "Moved product events from nightly batch to streaming through Kafka.", ["planted:over_sre"]),
  p("warehouse_access", "Warehouse access cleanup", "data_eng", "warehouse", -50, null, "Role based warehouse grants and automatic expiry for staging access.", ["team:appsec"]),
  p("search_relevance", "Search relevance", "ml", "search", -180, -40, "Learning to rank model for shipment and invoice search.", ["planted:over_data"]),
  p("recs_next_action", "Next best action", "ml", "recs", -40, null, "Suggests the next step for a shipper based on similar accounts."),
  p("kpi_layer", "Metrics layer", "analytics", "dashboards", -220, -110, "One definition per KPI, shared by every dashboard.", ["planted:over_data"]),
  p("secret_rotation", "Automatic secret rotation", "appsec", "secrets", -160, -20, "Rotates service credentials every 30 days without deploys.", ["planted:over_payments", "team:platform"]),
  p("access_quarterly", "Quarterly access review", "appsec", "access", -30, null, "Automates the quarterly review of production and data access."),
  p("helpdesk_sync", "Ticket to account sync", "support_eng", "helpdesk", -140, -50, "Links every support ticket to the account, shipments and invoices it concerns."),
  p("mdm_rollout", "MDM rollout", "it", "devices", -190, -95, "Moved every laptop onto managed profiles with zero touch setup."),
  p("onboarding_portal_v2", "New hire portal", "people", "onboarding_portal", -110, null, "First week checklist, buddy assignment and benefits enrollment in one place.", ["team:it"]),
  p("expense_cards", "Corporate cards", "finance", "expenses", -230, -130, "Issued corporate cards with per category limits and receipt matching."),
  p("q4_planning", "Planning for next year", "product_mgmt", null, -20, null, "Gathering roadmap bets for next year from every team.", ["planted:over_payments", "planted:over_mobile"]),
  p("research_panel", "Shipper research panel", "ux_research", null, -170, -60, "A standing panel of 40 shippers for interviews and usability tests.", ["team:product_design"]),
  p("csm_playbooks", "Escalation playbooks", "customer_success", null, -100, -10, "Shared playbooks for the ten most common enterprise escalations.", ["team:support_eng"]),
];

// ---------------------------------------------------------------------------
// Documents. Planted ones answer a scenario question outright; their text is written by hand.
// ---------------------------------------------------------------------------

export type DocDef = {
  id: string;
  title: string;
  kind: "onboarding" | "runbook" | "how_to" | "reference";
  service: string | null;
  /** "primary", "secondary" (of the service) or "team:<key>" (most senior IC there). */
  author: string;
  updated: number;
  body: string | null;
};

export const PLANTED_DOCS: DocDef[] = [
  {
    id: "doc_staging_db_access",
    title: "Requesting read access to the staging database",
    kind: "how_to",
    service: "svc_access",
    author: "primary",
    updated: -12,
    body: [
      "Staging database access is granted through access-review, not by asking someone to add you by hand.",
      "1. Open the access portal and choose Request access, then Staging Postgres (read only).",
      "2. Pick a reason (debugging, analysis or onboarding) and a duration. Access lasts 14 days by default and expires on its own.",
      "3. Your manager approves the request. Most requests are approved within one business day.",
      "4. Once approved, run `corvid db connect staging --readonly`. The command fetches short lived credentials from the vault; never copy a password into a file.",
      "Write access to staging is not granted to individuals. If you need to change data, ask the owning team to run a migration.",
      "If the command says your request is still pending after a day, ping your manager, not Security.",
    ].join("\n\n"),
  },
  {
    id: "doc_rotate_webhook_secret",
    title: "Rotating the Stripe webhook signing secret",
    kind: "runbook",
    service: "svc_billing",
    author: "secondary",
    updated: -30,
    body: [
      "Use this when the webhook signing secret may have leaked or when the 90 day rotation reminder fires.",
      "1. In the Stripe dashboard for the environment, roll the webhook endpoint secret and keep the old one valid for 24 hours.",
      "2. Store the new secret in vault-config under `billing/stripe/webhook_secret`. billing-service reads both the current and previous secret, so nothing breaks during the overlap.",
      "3. Restart billing-service with `corvid deploy billing-service --restart`. No code change is needed.",
      "4. Check the `billing_webhook_signature_failures` panel. It should stay at zero. A spike means a pod is still on the old config; restart it.",
      "5. After 24 hours, expire the old secret in Stripe.",
      "Staging uses its own Stripe account and its own secret. Never reuse the production secret in staging.",
    ].join("\n\n"),
  },
  {
    id: "doc_ios_code_signing",
    title: "Fixing code signing failures in mobile CI",
    kind: "runbook",
    service: "svc_mobile_build",
    author: "secondary",
    updated: -20,
    body: [
      "The most common iOS failure in mobile-ci is \"No signing certificate found\" or \"Provisioning profile doesn't include signing certificate\". It almost always means the certificates on the runner are stale, not that your code is wrong.",
      "1. Re-run the job once. Runners refresh certificates on start, and a cold runner sometimes misses the refresh.",
      "2. If it fails again, run the `sync-signing` job from the mobile-ci pipeline page. It pulls the current certificates and profiles from the signing repo with fastlane match in read only mode.",
      "3. Never run match in write mode from your laptop. It revokes the shared certificate and breaks every other build.",
      "4. If you added a new app extension, its bundle id must be added to the provisioning profiles first. Open a ticket in the Mobile channel with the bundle id.",
      "Android signing failures are different: check that the upload keystore secret exists for your branch's environment.",
    ].join("\n\n"),
  },
  {
    id: "doc_home_office_expenses",
    title: "Expensing your home office setup",
    kind: "how_to",
    service: "svc_expenses",
    author: "secondary",
    updated: -45,
    body: [
      "Every employee can expense up to $500 for home office equipment in their first 90 days, and $250 per year after that.",
      "What counts: a desk, a chair, a monitor, a keyboard, a headset, lighting. What does not: furniture for other rooms, internet service (covered by the monthly stipend), and laptops (IT provides those).",
      "1. Buy the item with a personal card, or with your corporate card if you already have one.",
      "2. In the expense system, create a report, choose the category Home office, and attach the receipt. Receipts are required for every item.",
      "3. Your manager approves it. Reimbursements land in the next payroll run.",
      "Spending over the limit needs your manager's written approval in the report comments before you buy.",
    ].join("\n\n"),
  },
  {
    id: "doc_add_feature_flag",
    title: "Adding a feature flag for your change",
    kind: "how_to",
    service: "svc_flags",
    author: "primary",
    updated: -15,
    body: [
      "Every user facing change ships behind a flag in flagd.",
      "1. Add the flag to `flags/<team>.yaml` in the flagd repo with an owner, a description and an expiry date no more than 90 days out.",
      "2. Open a pull request. The flagd CI checks the name (kebab case, prefixed with your team) and that the owner exists.",
      "3. After merge, the flag is available in every environment within five minutes, off by default.",
      "4. In code, read it with `flags.isOn(\"web-new-shipment-page\", ctx)`. Pass the request context so per account targeting works.",
      "5. Turn it on for internal accounts first from the flagd admin page, then roll out by percentage.",
      "For an A/B experiment instead of a plain rollout, set `kind: experiment` and list the variants. Analytics picks up assignments automatically.",
    ].join("\n\n"),
  },
  {
    id: "doc_join_oncall",
    title: "Joining an on-call rotation",
    kind: "onboarding",
    service: "svc_incident",
    author: "secondary",
    updated: -25,
    body: [
      "New engineers shadow one full on-call week before joining a rotation. You are never put on call alone in your first month.",
      "1. Ask your manager which rotation your team uses. Each service lists its rotation in the service catalog.",
      "2. In the incident bot, run `/oncall shadow <rotation>` to be added as a shadow for the next week. You get every page, but nobody expects you to fix anything.",
      "3. Read the runbooks for the services in that rotation before your shadow week starts.",
      "4. After your shadow week, your manager adds you as a primary with `/oncall add`.",
      "The current schedule for every rotation is in the incident bot: `/oncall who <rotation>`.",
    ].join("\n\n"),
  },
];

/** Generic onboarding docs not tied to a service. Bodies are templated. */
export const GENERAL_DOCS: DocDef[] = [
  { id: "doc_first_week", title: "Your first week at Corvid", kind: "onboarding", service: "svc_onboarding_portal", author: "primary", updated: -40, body: null },
  { id: "doc_laptop_setup", title: "Setting up your laptop and VPN", kind: "onboarding", service: "svc_devices", author: "primary", updated: -35, body: null },
  { id: "doc_eng_onboarding", title: "Engineering onboarding: from laptop to first deploy", kind: "onboarding", service: "svc_build", author: "primary", updated: -18, body: null },
  { id: "doc_pto_policy", title: "Time off and holidays", kind: "reference", service: "svc_onboarding_portal", author: "secondary", updated: -90, body: null },
  { id: "doc_incident_basics", title: "What to do when something breaks", kind: "onboarding", service: "svc_incident", author: "primary", updated: -50, body: null },
];

// ---------------------------------------------------------------------------
// Ask templates per service, for seeded history and the scenario questions.
// ---------------------------------------------------------------------------

export const ASK_TEMPLATES: Record<string, { title: string; body: string; tried: string }[]> = {
  svc_billing: [
    { title: "Duplicate charge after webhook retry", body: "A staging shipper got charged twice when a Stripe webhook retried. Where does billing-service check for duplicates?", tried: "Searched billing-service for idempotency and found two different keys." },
    { title: "Credits not applied to invoice", body: "An account credit shows in the admin page but the next charge ignored it.", tried: "Checked the credits table; the row is there." },
  ],
  svc_invoicing: [{ title: "Invoice PDF missing line items", body: "A customer's monthly invoice PDF only shows the first page of shipments.", tried: "Regenerated it locally and got the same result." }],
  svc_auth: [
    { title: "SSO login loops for one customer", body: "One enterprise shipper's SAML login sends users back to the sign-in page.", tried: "Their metadata XML looks valid in the validator." },
    { title: "Session expires too early on mobile", body: "Drivers are logged out after about an hour.", tried: "Refresh token call returns 401 in the logs." },
  ],
  svc_profiles: [{ title: "Custom role cannot see invoices", body: "A custom role with billing read permission still gets 403 on invoices.", tried: "Compared with the built in role; permissions look the same." }],
  svc_mobile_build: [
    { title: "iOS archive fails after Xcode upgrade", body: "The release build fails at the archive step since the runners moved to the new Xcode.", tried: "Cleared derived data and re-ran twice." },
    { title: "Android build slow on CI", body: "Android builds take 40 minutes on the release branch.", tried: "Gradle cache seems to be disabled for release jobs." },
  ],
  svc_push: [{ title: "Push notifications delayed", body: "Drivers get tracking pushes several minutes late.", tried: "The queue depth dashboard is flat." }],
  svc_web_app: [
    { title: "Shipment page slow to load", body: "The shipment detail page takes six seconds on large accounts.", tried: "Profiler shows a GraphQL query fetching every stop." },
    { title: "Where do I add a new route", body: "I need to add a settings page and cannot find where routes are registered.", tried: "Looked in the router folder but it seems generated." },
  ],
  svc_ui_kit: [{ title: "Button focus ring missing", body: "The secondary button has no visible focus ring in dark mode.", tried: "Checked the tokens file; the focus color exists." }],
  svc_flags: [{ title: "Flag not turning on in staging", body: "My flag is on in the admin page but code still sees it off.", tried: "Waited ten minutes and redeployed." }],
  svc_email: [{ title: "Onboarding email in spam", body: "The welcome email lands in spam for Gmail users.", tried: "SPF looks fine in the DNS checker." }],
  svc_build: [{ title: "CI cache misses every run", body: "My service rebuilds from scratch on every CI run.", tried: "Cache key looks stable between runs." }],
  svc_k8s: [
    { title: "Pod OOMKilled in staging", body: "My service's pod keeps getting OOMKilled in the staging cluster. How do I raise the memory limit?", tried: "Changed the limit in values.yaml but nothing changed after deploy." },
  ],
  svc_observability: [{ title: "Alert fires with no data", body: "An alert pages every night with \"no data\" for my service.", tried: "The metric exists in Grafana." }],
  svc_incident: [{ title: "How do I get added to on-call", body: "My manager wants me to join the on-call rotation. How do I get added?", tried: "Searched the wiki and found an old page." }],
  svc_ingest: [
    { title: "Kafka consumer lag growing", body: "Consumer lag on the shipment events topic keeps growing in the ingest pipeline.", tried: "Restarted the consumer; lag dropped and came back." },
    { title: "Airflow DAG stuck in queued", body: "The nightly events backfill DAG sits in queued for hours.", tried: "Other DAGs run fine." },
  ],
  svc_warehouse: [
    { title: "Need staging database access", body: "I need read access to the staging database to debug a report. Who can grant it?", tried: "Asked in my team channel." },
    { title: "dbt model fails on null shipper", body: "The shipments_daily model fails when shipper_id is null.", tried: "Added a filter locally and it passes." },
  ],
  svc_search: [{ title: "Search ranks archived shipments first", body: "Searching for an invoice number ranks archived shipments above recent ones.", tried: "Reindexed my test account." }],
  svc_recs: [{ title: "Next action suggestions empty", body: "New accounts get no next action suggestions.", tried: "Checked the feature store; rows exist." }],
  svc_dashboards: [{ title: "Revenue dashboard disagrees with finance", body: "Monthly revenue on the KPI dashboard is 3 percent lower than finance's number.", tried: "Compared the SQL; both exclude refunds." }],
  svc_secrets: [{ title: "Where do I store an API key", body: "I need to store a partner API key for my service. Where does it go?", tried: "Saw some keys in env files, not sure that is right." }],
  svc_access: [{ title: "Production read access", body: "I need read only access to production logs for an incident review.", tried: "Opened a ticket but it bounced." }],
  svc_helpdesk: [{ title: "Tickets not linked to accounts", body: "New tickets from one customer are not linked to their account.", tried: "Their email domain matches." }],
  svc_devices: [{ title: "VPN drops every hour", body: "The VPN disconnects every hour on my new laptop.", tried: "Reinstalled the client." }],
  svc_onboarding_portal: [{ title: "Benefits enrollment deadline", body: "When is the deadline to enroll in benefits as a new hire?", tried: "Checked the portal checklist." }],
  svc_expenses: [
    { title: "Corporate card declined", body: "My corporate card was declined for a conference ticket. Who can raise the limit?", tried: "Checked the card app; it shows available balance." },
    { title: "Expensing a monitor", body: "Can I expense a monitor for my home office, and how?", tried: "Looked for a policy page." },
  ],
};

// ---------------------------------------------------------------------------
// Scenarios: questions where the right answer is known in advance.
// ---------------------------------------------------------------------------

export type ScenarioDef = {
  id: string;
  kind: "owner_vs_decoy" | "overloaded" | "unavailable" | "documented";
  question: string;
  service: string;
  /** Who should come out on top, as a slot. "doc" means the app should point at the document first. */
  expect: string;
  /** People who look right but are not, as slots. */
  traps: string[];
  why: string;
  docId?: string;
};

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "scn_stripe_decoy",
    kind: "owner_vs_decoy",
    question: "A staging shipper got charged twice when a Stripe webhook retried. Where does billing-service check for duplicate events?",
    service: "svc_billing",
    expect: "service:secondary",
    traps: ["planted:decoy_stripe", "planted:over_payments"],
    why: "The decoy lists Stripe API in their profile but has never touched billing-service. The primary owner is overloaded this week, so the secondary owner should win.",
  },
  {
    id: "scn_kafka_decoy",
    kind: "owner_vs_decoy",
    question: "Consumer lag on the shipment events topic keeps growing in the ingest pipeline. Who can help?",
    service: "svc_ingest",
    expect: "service:secondary",
    traps: ["planted:decoy_kafka", "planted:over_data"],
    why: "The decoy ran Kafka at a previous job. The primary owner built the pipeline but is overloaded; the secondary owner knows it and has room.",
  },
  {
    id: "scn_k8s_decoy",
    kind: "owner_vs_decoy",
    question: "My pod keeps getting OOMKilled in the staging cluster. How do I raise the memory limit?",
    service: "svc_k8s",
    expect: "service:primary",
    traps: ["planted:decoy_k8s", "planted:over_sre"],
    why: "The decoy has a Kubernetes certificate but no cluster access. The primary owner of k8s-platform is the answer; the secondary is overloaded.",
  },
  {
    id: "scn_sso_vacation",
    kind: "unavailable",
    question: "One enterprise shipper's SAML login loops back to the sign-in page. Who owns SSO?",
    service: "svc_auth",
    expect: "service:secondary",
    traps: ["planted:vac_auth", "planted:decoy_oauth"],
    why: "The primary owner of auth-gateway is on vacation for the next week. The support engineer writes SSO help articles but has never changed the service.",
  },
  {
    id: "scn_ios_overloaded",
    kind: "overloaded",
    question: "The iOS release build fails at the archive step since the runners moved to the new Xcode. Who should I ask?",
    service: "svc_mobile_build",
    expect: "service:secondary",
    traps: ["planted:over_mobile", "planted:decoy_ios"],
    why: "The primary owner of mobile-ci has shipped every release and is far over their weekly ask limit. The web engineer with a hobby iOS app is a keyword match only.",
  },
  {
    id: "scn_search_booked",
    kind: "unavailable",
    question: "Searching for an invoice number ranks archived shipments above recent ones. Who works on search ranking?",
    service: "svc_search",
    expect: "service:secondary",
    traps: ["planted:booked_search"],
    why: "The primary owner of search-ranker is fully booked for the next eight days. The secondary owner has open time.",
  },
  {
    id: "scn_card_vacation",
    kind: "unavailable",
    question: "My corporate card was declined for a conference ticket. Who can raise my limit?",
    service: "svc_expenses",
    expect: "service:secondary",
    traps: ["planted:vac_finance"],
    why: "The primary owner of expense-sync is out of office for the next week.",
  },
  {
    id: "scn_doc_staging_db",
    kind: "documented",
    question: "How do I get read access to the staging database?",
    service: "svc_access",
    expect: "doc",
    traps: [],
    why: "The how-to explains the self-serve request flow, so nobody needs to be interrupted.",
    docId: "doc_staging_db_access",
  },
  {
    id: "scn_doc_webhook_secret",
    kind: "documented",
    question: "How do I rotate the Stripe webhook signing secret for billing?",
    service: "svc_billing",
    expect: "doc",
    traps: [],
    why: "The billing runbook covers rotation step by step.",
    docId: "doc_rotate_webhook_secret",
  },
  {
    id: "scn_doc_code_signing",
    kind: "documented",
    question: "My iOS build fails in CI with \"No signing certificate found\". What do I do?",
    service: "svc_mobile_build",
    expect: "doc",
    traps: [],
    why: "The mobile-ci runbook names this exact error and the fix.",
    docId: "doc_ios_code_signing",
  },
  {
    id: "scn_doc_home_office",
    kind: "documented",
    question: "Can I expense a monitor and a chair for my home office?",
    service: "svc_expenses",
    expect: "doc",
    traps: [],
    why: "The expense how-to lists the allowance and the steps.",
    docId: "doc_home_office_expenses",
  },
  {
    id: "scn_doc_feature_flag",
    kind: "documented",
    question: "How do I add a feature flag for my change?",
    service: "svc_flags",
    expect: "doc",
    traps: [],
    why: "The flagd how-to covers adding and rolling out a flag.",
    docId: "doc_add_feature_flag",
  },
  {
    id: "scn_doc_oncall",
    kind: "documented",
    question: "How do I get added to the on-call rotation?",
    service: "svc_incident",
    expect: "doc",
    traps: [],
    why: "The on-call onboarding doc explains shadowing and the bot commands.",
    docId: "doc_join_oncall",
  },
];

// ---------------------------------------------------------------------------
// Names. Combined by the seed into about 200 unique people.
// ---------------------------------------------------------------------------

export const FIRST_NAMES = [
  "Aaliyah", "Aarav", "Abebe", "Adaeze", "Adrian", "Aiko", "Alejandro", "Amara", "Amir", "Ana", "Anika", "Arjun", "Astrid", "Ayesha", "Beatriz",
  "Benjamin", "Bilal", "Bronwyn", "Camila", "Chen", "Chidi", "Clara", "Daniel", "Daria", "Deepa", "Diego", "Dmitri", "Elena", "Elif", "Emeka",
  "Emma", "Esther", "Farah", "Fatima", "Felix", "Gabriel", "Grace", "Hana", "Hassan", "Hiro", "Ines", "Isaac", "Isabel", "Jamal", "Javier",
  "Jin", "Joaquin", "Jonas", "Julia", "Kai", "Kalani", "Karim", "Keanu", "Kenji", "Kofi", "Lakshmi", "Laila", "Leah", "Leon", "Lucia",
  "Luis", "Maya", "Mateo", "Mei", "Miguel", "Mira", "Nadia", "Naomi", "Nikhil", "Nina", "Noah", "Nora", "Oluwaseun", "Omar", "Oren",
  "Pablo", "Priya", "Quinn", "Rafael", "Rahul", "Rania", "Ravi", "Rosa", "Ruth", "Sakura", "Samuel", "Sana", "Santiago", "Sara", "Sean",
  "Sofia", "Soo-ah", "Tariq", "Tendai", "Thandiwe", "Theo", "Tomas", "Uma", "Valeria", "Vikram", "Wei", "Yara", "Yusuf", "Zara", "Zoe",
];

export const LAST_NAMES = [
  "Abara", "Adeyemi", "Agarwal", "Alvarez", "Andersen", "Bakshi", "Banerjee", "Bauer", "Bello", "Bianchi", "Castillo", "Chakraborty", "Chen", "Cohen", "Costa",
  "Da Silva", "Diallo", "Dubois", "Eze", "Fernandes", "Fischer", "Fujita", "Garcia", "Ghosh", "Gonzalez", "Gupta", "Haddad", "Hansen", "Hernandez", "Hoang",
  "Ibrahim", "Ito", "Iyer", "Jensen", "Johansson", "Kapoor", "Kato", "Khan", "Kim", "Kowalski", "Kumar", "Larsen", "Lee", "Lindqvist", "Lopez",
  "Mahlangu", "Martin", "Mendoza", "Mensah", "Moreau", "Mukherjee", "Murphy", "Nakamura", "Nguyen", "Novak", "Nwosu", "Okafor", "Okonkwo", "Oliveira", "Ortiz",
  "Osei", "Park", "Patel", "Pereira", "Petrov", "Quispe", "Rahman", "Ramirez", "Rao", "Reyes", "Rossi", "Saito", "Santos", "Schmidt", "Shah",
  "Silva", "Singh", "Sokolov", "Suzuki", "Tanaka", "Torres", "Tran", "Usman", "Vargas", "Vasquez", "Wang", "Weber", "Wong", "Yamamoto", "Yilmaz",
  "Zhang", "Zhou",
];
