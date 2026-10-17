// Local, deterministic text embedding. No network, no key, identical output on every machine.
//
// Why local: the fixture (fixtures/company.json) commits an embedding for every employee, service
// and document, and demo mode must never call an embedding API. Queries at runtime have to be
// embedded by the same function as the fixture, so this module is the one place that does it.
//
// How: lowercase words, a light stemmer, an alias table that maps jargon onto shared terms
// ("k8s" and "kube" both add "kubernetes"), then unigrams and bigrams are hashed into
// EMBEDDING_DIMS buckets with a sign bit (the hashing trick), weighted by 1 + log(tf), and the
// vector is L2 normalised so cosine distance in pgvector behaves.
//
// It is a lexical embedding, not a semantic one. Ownership and skill signals carry most of the
// ranking; this is the recall step. EMBEDDING_MODEL is stored in the fixture, so a later prompt
// can swap in a hosted model by regenerating the fixture and bumping the name.

export const EMBEDDING_MODEL = "w2a-hash-256-v1";
export const EMBEDDING_DIMS = 256;

const STOP = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its me my of on or our so that the their them then there these this to was we what when where which who why will with you your".split(
    " ",
  ),
);

/** Jargon to shared terms. Keys are matched after lowercasing and stemming. */
const ALIASES: Record<string, string[]> = {
  k8s: ["kubernetes"],
  kube: ["kubernetes"],
  kubectl: ["kubernetes"],
  helm: ["kubernetes", "deploy"],
  pod: ["kubernetes"],
  cluster: ["kubernetes"],
  oomkill: ["kubernetes", "memory"],
  oomkilled: ["kubernetes", "memory"],
  namespace: ["kubernetes"],
  ci: ["build", "pipeline"],
  cd: ["deploy", "pipeline"],
  deploy: ["release"],
  sso: ["auth", "login"],
  oauth: ["auth", "login"],
  saml: ["auth", "sso"],
  login: ["auth"],
  signin: ["auth", "login"],
  password: ["auth"],
  token: ["auth"],
  jwt: ["auth", "token"],
  stripe: ["payment", "billing"],
  invoice: ["billing"],
  charge: ["billing", "payment"],
  refund: ["billing", "payment"],
  webhook: ["integration"],
  ios: ["mobile", "build"],
  android: ["mobile", "build"],
  xcode: ["ios", "mobile"],
  fastlane: ["mobile", "build", "release"],
  testflight: ["ios", "release"],
  sign: ["certificate"],
  kafka: ["stream", "pipeline"],
  airflow: ["pipeline", "schedule"],
  dag: ["pipeline", "airflow"],
  dbt: ["warehouse", "sql"],
  etl: ["pipeline", "ingest"],
  snowflake: ["warehouse"],
  warehouse: ["sql", "data"],
  grafana: ["observability", "dashboard"],
  prometheus: ["observability", "metric"],
  alert: ["observability", "oncall"],
  page: ["oncall", "incident"],
  oncall: ["incident", "rotation"],
  rotation: ["oncall"],
  pager: ["oncall", "incident"],
  outage: ["incident"],
  sev: ["incident"],
  terraform: ["infrastructure"],
  vault: ["secret"],
  credential: ["secret"],
  flag: ["experiment", "feature"],
  experiment: ["abtest"],
  laptop: ["device", "it"],
  vpn: ["network", "it"],
  expense: ["finance", "reimburse"],
  card: ["expense", "finance"],
  declin: ["card", "expense"],
  reimburse: ["finance", "expense"],
  payroll: ["people", "finance"],
  pto: ["people", "leave"],
  vacation: ["leave", "pto"],
  benefit: ["people"],
  figma: ["design"],
  ux: ["design", "research"],
  a11y: ["accessibility"],
  search: ["ranking"],
  recommend: ["ranking", "ml"],
  model: ["ml"],
  dashboard: ["analytics", "report"],
  looker: ["analytics", "dashboard"],
  ticket: ["support", "helpdesk"],
  zendesk: ["support", "helpdesk"],
  customer: ["support"],
  postgres: ["database", "sql"],
  db: ["database"],
  staging: ["environment"],
  prod: ["production"],
};

/** Very light stemming so "builds", "building" and "built" land together. */
function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w === "built") return "build";
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    // Hyphenated jargon would otherwise split into two weak words.
    .replace(/\bon[- ]call\b/g, "oncall")
    .replace(/\bsign[- ]in\b/g, "signin")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/[\s.-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
  const out: string[] = [];
  for (const w of words) {
    out.push(w);
    for (const extra of ALIASES[w] ?? []) out.push(extra);
  }
  return out;
}

/** FNV-1a 32 bit. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function embedText(text: string): number[] {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  const add = (f: string, w: number) => counts.set(f, (counts.get(f) ?? 0) + w);
  for (let i = 0; i < tokens.length; i++) {
    add(tokens[i], 1);
    if (i + 1 < tokens.length) add(`${tokens[i]}_${tokens[i + 1]}`, 0.5);
  }
  const v = new Array<number>(EMBEDDING_DIMS).fill(0);
  for (const [feature, tf] of counts) {
    const h = hash(feature);
    const sign = h & 1 ? 1 : -1;
    v[(h >>> 1) % EMBEDDING_DIMS] += sign * (1 + Math.log(tf));
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  // Rounded so the committed fixture stays small and diffs stay stable.
  return norm === 0 ? v : v.map((x) => Math.round((x / norm) * 1e4) / 1e4);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
