import "server-only";
// Read model for /insights: the anonymous, aggregate view across every ask. Four panels, each one
// query, each cell through kAnon (src/lib/k-anon.ts). Nothing here returns ask text or who asked.
// One line per panel:
//
//   [insights] INFO insights panel topics: query insights.topics -> 92 rows; 9 cells shown, 31 suppressed (k=5); panel shown
//
// The org-level opt-in lives in app_meta "insights.opt_in". When it is off no panel query runs.

import { eq, sql } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { wallNow } from "./clock";
import { type KCell, kAnon, K_MIN_ASKS, type KStats, newStats } from "./k-anon";
import { createLogger } from "./log";

const log = createLogger("insights");

export const OPT_IN_KEY = "insights.opt_in";
/** How many topics the topic panel ranks, and how many weeks it shows. */
export const TOP_TOPICS = 8;
export const WEEKS_SHOWN = 4;
/** Recipients shown by name in the load panel; everyone else is one aggregate row. */
export const TOP_RECIPIENTS = 8;

export type OptIn = { on: boolean; by: string; at: string | null; why: string };

export async function getOptIn(): Promise<OptIn> {
  const rows = await q("insights.opt_in.get", (db) => db.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, OPT_IN_KEY)).limit(1));
  if (!rows[0]) {
    log.branch("insights opt-in is off", `no ${OPT_IN_KEY} in app_meta (database not seeded since prompt 9, or never opted in)`);
    return { on: false, by: "nobody", at: null, why: "never opted in" };
  }
  try {
    const v = JSON.parse(rows[0].value) as Partial<OptIn>;
    const out: OptIn = { on: v.on === true, by: v.by ?? "unknown", at: v.at ?? null, why: v.why ?? "" };
    log.info(`insights opt-in is ${out.on ? "ON" : "OFF"} (set by ${out.by} at ${out.at ?? "unknown time"})`);
    return out;
  } catch (err) {
    log.error(`${OPT_IN_KEY} in app_meta is not valid JSON, treating insights as opted out`, { err });
    return { on: false, by: "unknown", at: null, why: "unreadable setting" };
  }
}

export async function setOptIn(admin: { id: string; email: string }, on: boolean): Promise<OptIn> {
  const value: OptIn = { on, by: admin.id, at: wallNow().toISOString(), why: on ? "turned on by an admin on /insights" : "turned off by an admin on /insights" };
  await q("insights.opt_in.set", (db) =>
    db
      .insert(t.appMeta)
      .values({ key: OPT_IN_KEY, value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: t.appMeta.key, set: { value: JSON.stringify(value), updatedAt: wallNow() } }),
  );
  log.info(`admin decision: ${admin.id} <${admin.email}> turned insights ${on ? "ON" : "OFF"} for the org at ${value.at}`);
  return value;
}

function panelLine(name: string, label: string, rows: number, s: KStats): "shown" | "suppressed" | "empty" {
  const state = rows === 0 ? "empty" : s.shown === 0 ? "suppressed" : "shown";
  log.info(`insights panel ${name}: query ${label} -> ${rows} rows; ${s.shown} cells shown, ${s.suppressed} suppressed (k=${K_MIN_ASKS}); panel ${state}`, { panel: name, rows, ...s });
  return state;
}

export type PanelState = "shown" | "suppressed" | "empty";

const weekLabel = (iso: string) => `week of ${new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;

// ---------------------------------------------------------------------------
// topics (shared by the topic panel and the services panel)
// ---------------------------------------------------------------------------

type TopicRow = { svc: string; name: string; week: string; n: number };

/**
 * The topic of an ask is each service it is about: the confirmed understanding for app asks, the
 * service it was routed about for seeded history. Drafts (never submitted) are left out.
 */
async function topicRows(): Promise<TopicRow[]> {
  return q("insights.topics", (db) =>
    db.execute<TopicRow>(sql`
      select tp.svc, s.name, to_char(date_trunc('week', a.created_at), 'YYYY-MM-DD') as week, count(distinct a.id)::int as n
      from asks a
      cross join lateral (
        select x->>'id' as svc
        from jsonb_array_elements(case when jsonb_typeof(a.understanding->'services') = 'array' then a.understanding->'services' else '[]'::jsonb end) x
        union
        select c.breakdown->>'serviceId' from ask_candidates c where c.ask_id = a.id and a.source = 'seed'
      ) tp
      join services s on s.id = tp.svc
      where a.status <> 'draft'
      group by 1, 2, 3`),
  ).then((r) => [...r]);
}

export type TopicsPanel = {
  state: PanelState;
  weeks: Array<{ iso: string; label: string }>;
  topics: Array<{ id: string; name: string; total: KCell<number>; byWeek: Array<KCell<number>> }>;
  hiddenTopics: number;
  totalAsks: KCell<number>;
  /** Distinct asks per shown week, all topics together. */
  weekTotals: Array<KCell<number>>;
};

export async function topicsPanel(): Promise<TopicsPanel> {
  const [rows, weekly] = await Promise.all([
    topicRows(),
    q("insights.weekly", (db) =>
      db.execute<{ week: string; n: number }>(sql`select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week, count(*)::int as n from asks where status <> 'draft' group by 1`),
    ),
  ]);
  const s = newStats();
  const weeks = [...new Set(rows.map((r) => r.week))].sort().slice(-WEEKS_SHOWN);
  const bySvc = new Map<string, { name: string; total: number; weeks: Map<string, number> }>();
  for (const r of rows) {
    const e = bySvc.get(r.svc) ?? { name: r.name, total: 0, weeks: new Map() };
    e.total += r.n;
    e.weeks.set(r.week, (e.weeks.get(r.week) ?? 0) + r.n);
    bySvc.set(r.svc, e);
  }
  const ranked = [...bySvc.entries()].sort((a, b) => b[1].total - a[1].total || a[1].name.localeCompare(b[1].name));
  const top = ranked.slice(0, TOP_TOPICS);
  const topics = top.map(([id, e]) => ({
    id,
    name: e.name,
    total: kAnon("topics", `${e.name}, all weeks`, e.total, e.total, s),
    byWeek: weeks.map((w) => kAnon("topics", `${e.name}, ${weekLabel(w)}`, e.weeks.get(w) ?? 0, e.weeks.get(w) ?? 0, s)),
  }));
  const all = rows.reduce((n, r) => n + r.n, 0);
  log.debug(`topics: ${bySvc.size} topics across ${weeks.length} weeks, top ${top.length} ranked; ${ranked.length - top.length} more not shown`, { weeks });
  const weekTotals = weeks.map((w) => {
    const n = [...weekly].find((r) => r.week === w)?.n ?? 0;
    return kAnon("topics", `all topics, ${weekLabel(w)}`, n, n, s);
  });
  const state = panelLine("topics", "insights.topics + insights.weekly", rows.length, s);
  return { state, weekTotals, weeks: weeks.map((iso) => ({ iso, label: weekLabel(iso) })), topics, hiddenTopics: Math.max(0, ranked.length - top.length), totalAsks: kAnon("topics", "all topics, all weeks", all, all) };
}

// ---------------------------------------------------------------------------
// services next to their documents
// ---------------------------------------------------------------------------

export type DocCoverage = "no_doc" | "overview_only" | "has_howto";

export const COVERAGE_LABEL: Record<DocCoverage, string> = {
  no_doc: "No document",
  overview_only: "Overview only",
  has_howto: "Runbook or how-to",
};

export type ServicesPanel = {
  state: PanelState;
  rows: Array<{ id: string; name: string; team: string; asks: KCell<number>; docs: number; kinds: string[]; coverage: DocCoverage; docFailed: KCell<number>; gap: boolean }>;
  gaps: number;
};

export async function servicesPanel(): Promise<ServicesPanel> {
  const [topics, svcs] = await Promise.all([
    topicRows(),
    q("insights.services_docs", (db) =>
      db.execute<{ id: string; name: string; team: string; docs: number; kinds: string[] | null; doc_failed: number }>(sql`
        select s.id, s.name, s.team,
          (select count(*) from documents d where d.service_id = s.id)::int as docs,
          (select array_agg(distinct d.kind::text order by d.kind::text) from documents d where d.service_id = s.id) as kinds,
          (select count(*) from ask_doc_checks dc join documents d on d.id = dc.document_id where d.service_id = s.id and dc.verdict = 'not_answered')::int as doc_failed
        from services s`),
    ),
  ]);
  const s = newStats();
  const asksBy = new Map<string, number>();
  for (const r of topics) asksBy.set(r.svc, (asksBy.get(r.svc) ?? 0) + r.n);
  const rows = [...svcs]
    .map((r) => {
      const kinds = r.kinds ?? [];
      const coverage: DocCoverage = r.docs === 0 ? "no_doc" : kinds.some((k) => k === "runbook" || k === "how_to") ? "has_howto" : "overview_only";
      const n = asksBy.get(r.id) ?? 0;
      const asks = kAnon("services", `${r.name} asks`, n, n, s);
      const docFailed = kAnon("services", `${r.name} doc not answered`, r.doc_failed, r.doc_failed, s);
      return { id: r.id, name: r.name, team: r.team, asks, docs: r.docs, kinds, coverage, docFailed, gap: asks.shown && coverage !== "has_howto", n };
    })
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map(({ n: _n, ...rest }) => rest);
  const gaps = rows.filter((r) => r.gap);
  for (const g of gaps) log.info(`insights gap: ${g.name} has ${g.asks.count} asks and ${COVERAGE_LABEL[g.coverage].toLowerCase()} (${g.docs} docs: ${g.kinds.join(", ") || "none"})`);
  const state = panelLine("services", "insights.topics + insights.services_docs", svcs.length, s);
  return { state, rows, gaps: gaps.length };
}

// ---------------------------------------------------------------------------
// where documentation failed
// ---------------------------------------------------------------------------

export type DocFailurePanel = {
  state: PanelState;
  rows: Array<{ id: string; title: string; kind: string; service: string | null; failed: KCell<number>; answered: KCell<number> }>;
  hiddenDocs: number;
  totalFailed: KCell<number>;
  totalAnswered: KCell<number>;
};

export async function docFailurePanel(): Promise<DocFailurePanel> {
  const rows = await q("insights.doc_failures", (db) =>
    db.execute<{ id: string; title: string; kind: string; service: string | null; failed: number; answered: number }>(sql`
      select d.id, d.title, d.kind::text as kind, s.name as service,
        count(*) filter (where dc.verdict = 'not_answered')::int as failed,
        count(*) filter (where dc.verdict = 'answered')::int as answered
      from ask_doc_checks dc
      join documents d on d.id = dc.document_id
      left join services s on s.id = d.service_id
      where dc.verdict is not null
      group by 1, 2, 3, 4
      order by failed desc, answered desc, d.title`),
  );
  const s = newStats();
  const out = [...rows].map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    service: r.service,
    failed: kAnon("doc_failures", `${r.id} not answered`, r.failed, r.failed, s),
    // Answered counts are shown only next to a shown failure count, and only above k themselves.
    answered: kAnon("doc_failures", `${r.id} answered`, r.answered, r.answered),
  }));
  const shown = out.filter((r) => r.failed.shown);
  const failed = rows.reduce((n, r) => n + r.failed, 0);
  const answered = rows.reduce((n, r) => n + r.answered, 0);
  const state = panelLine("doc_failures", "insights.doc_failures", rows.length, s);
  return { state, rows: shown, hiddenDocs: out.length - shown.length, totalFailed: kAnon("doc_failures", "all docs not answered", failed, failed), totalAnswered: kAnon("doc_failures", "all docs answered", answered, answered) };
}

// ---------------------------------------------------------------------------
// routing load
// ---------------------------------------------------------------------------

export type LoadPanel = {
  state: PanelState;
  total: KCell<number>;
  people: number;
  recipients: number;
  top: Array<{ id: string; name: string; title: string; team: string; count: KCell<number>; share: number }>;
  rest: { people: number; count: KCell<number>; share: number };
  /** Cumulative share of routed asks after the top n recipients, n = 0..recipients. */
  curve: number[];
  top3Share: number;
  /** How many people absorb half of all routed asks. */
  halfBy: number;
};

export async function loadPanel(): Promise<LoadPanel> {
  // Each "sent" transition is one ask sent to one person (rerouted asks count once per person).
  const [rows, [{ people }]] = await Promise.all([
    q("insights.routing_load", (db) =>
      db.execute<{ id: string; name: string; title: string; team: string; n: number }>(sql`
        select e2.id, e2.name, e2.title, e2.team, count(*)::int as n
        from ask_events ev
        join asks a on a.id = ev.ask_id
        join employees e2 on e2.id = coalesce(ev.data->>'recipientId', a.routed_to_id)
        where ev.to_state = 'sent'
        group by 1, 2, 3, 4
        order by n desc, e2.name`),
    ),
    q("insights.headcount", (db) => db.execute<{ people: number }>(sql`select count(*)::int as people from employees`)),
  ]);
  const s = newStats();
  const total = rows.reduce((n, r) => n + r.n, 0);
  const share = (n: number) => (total ? n / total : 0);
  const top = [...rows].slice(0, TOP_RECIPIENTS).map((r) => ({ id: r.id, name: r.name, title: r.title, team: r.team, count: kAnon("routing_load", `${r.id} received`, r.n, r.n, s), share: share(r.n) }));
  const named = top.filter((r) => r.count.shown);
  const restRows = rows.filter((r) => !named.some((x) => x.id === r.id));
  const restN = restRows.reduce((n, r) => n + r.n, 0);
  let acc = 0;
  const curve = [0, ...rows.map((r) => (acc += r.n) / (total || 1))];
  const halfBy = curve.findIndex((c) => c >= 0.5);
  const top3Share = curve[Math.min(3, rows.length)] ?? 0;
  const state = panelLine("routing_load", "insights.routing_load", rows.length, s);
  log.info(`routing load: ${total} sends to ${rows.length} of ${people} people; top 3 received ${Math.round(top3Share * 100)}%; ${halfBy} people absorb half`);
  return {
    state,
    total: kAnon("routing_load", "all sends", total, total),
    people,
    recipients: rows.length,
    top: named,
    rest: { people: restRows.length, count: kAnon("routing_load", "everyone else", restN, restN, s), share: share(restN) },
    curve,
    top3Share,
    halfBy,
  };
}
