import Link from "next/link";
import { Suspense } from "react";
import { Bar, BarList, ConcentrationCurve, Suppressed, WeekLine } from "@/components/charts";
import { Container, PageHeader } from "@/components/page-header";
import { Toc } from "@/components/toc";
import { Badge } from "@/components/ui/badge";
import { SkeletonBlock, SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getSessionUser } from "@/lib/auth";
import { toAppError } from "@/lib/errors";
import {
  COVERAGE_LABEL,
  type DocFailurePanel,
  docFailurePanel,
  getOptIn,
  type LoadPanel,
  loadPanel,
  type ServicesPanel,
  servicesPanel,
  TOP_TOPICS,
  type TopicsPanel,
  topicsPanel,
} from "@/lib/insights";
import { K_MIN_ASKS } from "@/lib/k-anon";
import { createLogger, currentReqId } from "@/lib/log";
import { withPage } from "@/lib/request-context";
import { OptInToggle } from "./opt-in-toggle";

export const metadata = { title: "Insights" };

const log = createLogger("page.insights");

type Failed = { failed: true; code: string; reqId: string | null };
type Loaded<T> = Promise<T | Failed>;

function settle<T>(name: string, p: Promise<T>): Loaded<T> {
  return p.catch((err) => {
    const e = toAppError(err);
    log.error(`insights panel ${name} failed with ${e.code}`, { err });
    return { failed: true as const, code: e.code, reqId: currentReqId() };
  });
}
const isFailed = (x: unknown): x is Failed => !!x && typeof x === "object" && "failed" in x;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const NOT_ENOUGH = "Not enough data to show this without identifying someone.";

export default async function Page() {
  return withPage("insights", async () => {
    const [user, optIn] = await Promise.all([getSessionUser(), getOptIn()]);
    const isAdmin = user?.role === "admin";
    let panels: { topics: Loaded<TopicsPanel>; services: Loaded<ServicesPanel>; docs: Loaded<DocFailurePanel>; load: Loaded<LoadPanel> } | null = null;
    if (optIn.on) {
      log.branch("load all four panels", `org opted in (by ${optIn.by})`);
      panels = { topics: settle("topics", topicsPanel()), services: settle("services", servicesPanel()), docs: settle("doc_failures", docFailurePanel()), load: settle("routing_load", loadPanel()) };
    } else {
      log.skip("every insights panel query", "the org has not opted in; no aggregate query runs");
    }
    const off = <EmptyState title="The org has not opted in" body="An admin turns this view on for the whole org with the switch above. Until then no aggregate query runs." />;

    return (
      <Container>
        <PageHeader
          eyebrow="/insights"
          title="Insights"
          description="Where new hires get stuck, read from every ask at once. The asks show where onboarding is broken; this page shows it without showing anyone."
        />
        <div className="flex flex-col-reverse gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div id="insights" className="flex min-w-0 flex-col gap-12">
            <section aria-labelledby="the-rules">
              <h2 id="the-rules" className="mb-3 text-lg font-semibold">
                The rules on this page
              </h2>
              <div className="border border-fg bg-raised">
                <ol className="grid gap-px bg-line sm:grid-cols-2">
                  {[
                    ["Aggregated only", "Every number is a count across many asks. No row is one ask."],
                    [`At least ${K_MIN_ASKS} asks per cell`, `A cell built from fewer than ${K_MIN_ASKS} asks does not render. It says "not enough data" instead.`],
                    ["No ask text", "Nothing anyone typed appears here: not the question, not what they tried, not their notes."],
                    ["No asker identity", "Who asked is never shown, counted per person, or used to filter. Only the people who were asked appear, by load."],
                  ].map(([title, body], i) => (
                    <li key={title} className="bg-raised px-4 py-3">
                      <p className="text-sm font-semibold">
                        <span className="mr-2 font-mono text-[12px] text-muted">{i + 1}</span>
                        {title}
                      </p>
                      <p className="mt-1 text-[13px] text-muted">{body}</p>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                  <div className="text-sm">
                    <p className="font-semibold">5. Opt-in at the org level</p>
                    <p className="text-[13px] text-muted">
                      {optIn.on ? "On" : "Off"}
                      {optIn.at ? `, set by ${optIn.by === "seed" ? "the demo seed" : `admin ${optIn.by}`} on ${optIn.at.slice(0, 10)}` : ""}.
                    </p>
                  </div>
                  <OptInToggle on={optIn.on} canChange={isAdmin} />
                </div>
              </div>
            </section>

            <section aria-labelledby="top-topics">
              <h2 id="top-topics" className="mb-1 text-lg font-semibold">
                Top topics new hires are stuck on
              </h2>
              <p className="mb-4 text-[13px] text-muted">The services asks are about, by count over all time and by week. Seeded history is asks from new hires and junior staff.</p>
              {panels ? (
                <Suspense fallback={<PanelSkeleton />}>
                  <Topics data={panels.topics} />
                </Suspense>
              ) : (
                off
              )}
            </section>

            <section aria-labelledby="services-and-docs">
              <h2 id="services-and-docs" className="mb-1 text-lg font-semibold">
                Services that generate asks, next to their documents
              </h2>
              <p className="mb-4 text-[13px] text-muted">
                Many asks and no runbook or how-to is the gap worth fixing first: someone keeps answering the same question by hand.
              </p>
              {panels ? (
                <Suspense fallback={<SkeletonTable rows={8} cols={5} />}>
                  <Services data={panels.services} />
                </Suspense>
              ) : (
                off
              )}
            </section>

            <section aria-labelledby="documentation-failed">
              <h2 id="documentation-failed" className="mb-1 text-lg font-semibold">
                Where documentation failed
              </h2>
              <p className="mb-4 text-[13px] text-muted">
                Documents Who2Ask offered before searching for a person, where the asker said &quot;No, find a person&quot;. Each one is a page that exists and still did not
                answer the question.
              </p>
              {panels ? (
                <Suspense fallback={<PanelSkeleton />}>
                  <DocFailures data={panels.docs} />
                </Suspense>
              ) : (
                off
              )}
            </section>

            <section aria-labelledby="routing-load">
              <h2 id="routing-load" className="mb-1 text-lg font-semibold">
                Routing load across the company
              </h2>
              <p className="mb-4 text-[13px] text-muted">Who the asks were sent to. When a few people absorb most questions, they are the bottleneck and the first people to document what they know.</p>
              {panels ? (
                <Suspense fallback={<PanelSkeleton />}>
                  <Load data={panels.load} />
                </Suspense>
              ) : (
                off
              )}
            </section>

            <section aria-labelledby="how-counted">
              <h2 id="how-counted" className="mb-3 text-lg font-semibold">
                How these numbers are made
              </h2>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-muted">
                <li>An ask counts once per service it is about: the services the asker confirmed, or for seeded history, the service it was routed about. Unsubmitted drafts are left out.</li>
                <li>Weeks start on Monday (UTC) and use when the ask was written.</li>
                <li>A document failed when it was offered on the confirm step and the asker chose to find a person instead.</li>
                <li>Routing load counts each time an ask was sent to a person, so an ask rerouted to a second person counts once for each.</li>
                <li>
                  The threshold check is one function (<span className="font-mono">kAnon</span>); every suppressed cell is written to the server log with its panel. See also the{" "}
                  <Link href="/privacy">privacy policy</Link>.
                </li>
              </ul>
            </section>
          </div>
          <Toc rootId="insights" className="border border-line bg-raised p-4 lg:border-0 lg:bg-transparent lg:p-0" />
        </div>
      </Container>
    );
  });
}

function PanelSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3" role="status" aria-busy="true" aria-label="Loading">
      <SkeletonBlock height={160} />
      <SkeletonTable rows={4} cols={4} />
    </div>
  );
}

function PanelError({ f }: { f: Failed }) {
  return <ErrorState title="This panel could not load" code={f.code} reqId={f.reqId} />;
}

function NotEnough({ what }: { what?: string }) {
  return <EmptyState title="Not enough data to show this without identifying someone" body={what ?? `Every cell here would be built from fewer than ${K_MIN_ASKS} asks.`} />;
}

async function Topics({ data }: { data: Loaded<TopicsPanel> }) {
  const d = await data;
  if (isFailed(d)) return <PanelError f={d} />;
  if (d.state !== "shown") return <NotEnough />;
  const maxTotal = Math.max(1, ...d.topics.map((t) => t.total.count ?? 0));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div>
        <h3 id="by-count" className="mb-2 text-sm font-semibold">
          By count
        </h3>
        <BarList
          max={maxTotal}
          items={d.topics.map((t) => ({
            key: t.id,
            label: t.name,
            value: t.total.count,
            display: t.total.count,
            title: t.total.shown ? `${t.name}: ${t.total.count} asks` : `${t.name}: ${NOT_ENOUGH}`,
          }))}
        />
        <p className="mt-2 text-[12px] text-muted">
          Top {TOP_TOPICS} of {d.topics.length + d.hiddenTopics} topics. {d.totalAsks.shown ? `${d.totalAsks.count} topic counts in all.` : null}
        </p>
      </div>
      <div>
        <h3 id="by-week" className="mb-2 text-sm font-semibold">
          By week
        </h3>
        <WeekLine
          points={d.weeks.map((w, i) => ({ label: w.label.replace("week of ", ""), value: d.weekTotals[i].count }))}
          label="Asks per week, all topics together (weeks start Monday). The table below splits the same weeks by topic."
        />
        <div className="mt-4" />
        <Table>
          <THead>
            <TR>
              <TH>Topic</TH>
              {d.weeks.map((w) => (
                <TH key={w.iso} className="text-right whitespace-nowrap">
                  {w.label.replace("week of ", "")}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {d.topics.map((t) => (
              <TR key={t.id}>
                <TD className="whitespace-nowrap">{t.name}</TD>
                {t.byWeek.map((w, i) => (
                  <TD key={d.weeks[i].iso} className="text-right font-mono text-[12px]">
                    {w.shown ? w.count : <Suppressed short />}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="mt-2 text-[12px] text-muted">&quot;under 5&quot; means that week had too few asks on the topic to show; the line breaks there.</p>
      </div>
    </div>
  );
}

async function Services({ data }: { data: Loaded<ServicesPanel> }) {
  const d = await data;
  if (isFailed(d)) return <PanelError f={d} />;
  if (d.state !== "shown") return <NotEnough />;
  const max = Math.max(1, ...d.rows.map((r) => r.asks.count ?? 0));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <p className="text-sm">
        <span className="font-mono">{d.gaps}</span> {d.gaps === 1 ? "service has" : "services have"} at least {K_MIN_ASKS} asks and no runbook or how-to.
      </p>
      <Table>
        <THead>
          <TR>
            <TH>Service</TH>
            <TH className="w-36">Asks</TH>
            <TH className="text-right">Count</TH>
            <TH>Documents</TH>
            <TH className="text-right">Doc did not answer</TH>
            <TH>Finding</TH>
          </TR>
        </THead>
        <TBody>
          {d.rows.map((r) => (
            <TR key={r.id}>
              <TD className="whitespace-nowrap">
                <span className="font-mono text-[13px]">{r.name}</span>
                <span className="block text-[12px] text-muted">{r.team}</span>
              </TD>
              <TD>
                <Bar value={r.asks.count} max={max} title={r.asks.shown ? `${r.name}: ${r.asks.count} asks` : `${r.name}: ${NOT_ENOUGH}`} />
              </TD>
              <TD className="text-right font-mono text-[12px]">{r.asks.shown ? r.asks.count : <Suppressed short />}</TD>
              <TD className="text-[13px]">
                {COVERAGE_LABEL[r.coverage]}
                <span className="block text-[12px] text-muted">
                  {r.docs} {r.docs === 1 ? "doc" : "docs"}
                  {r.kinds.length ? `: ${r.kinds.map((k) => k.replace("_", " ")).join(", ")}` : ""}
                </span>
              </TD>
              <TD className="text-right font-mono text-[12px]">{r.docFailed.shown ? r.docFailed.count : <Suppressed short />}</TD>
              <TD>{r.gap ? <Badge tone="accent">Gap: write a runbook</Badge> : r.asks.shown ? <span className="text-[12px] text-muted">Covered</span> : <Suppressed />}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

async function DocFailures({ data }: { data: Loaded<DocFailurePanel> }) {
  const d = await data;
  if (isFailed(d)) return <PanelError f={d} />;
  if (d.state === "empty") return <EmptyState title="No document verdicts yet" body="Nobody has said whether an offered document answered them." />;
  if (d.state !== "shown") return <NotEnough what={`No document failed ${K_MIN_ASKS} or more asks yet.`} />;
  const max = Math.max(1, ...d.rows.map((r) => r.failed.count ?? 0));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <p className="text-sm">
        {d.totalFailed.shown ? (
          <>
            <span className="font-mono">{d.totalFailed.count}</span> times an offered document did not answer the question
          </>
        ) : (
          "Offered documents did not answer some questions"
        )}
        {d.totalAnswered.shown ? (
          <>
            , against <span className="font-mono">{d.totalAnswered.count}</span> times one did
          </>
        ) : null}
        .
      </p>
      <BarList
        max={max}
        items={d.rows.map((r) => ({
          key: r.id,
          label: (
            <Link href={`/docs/${r.id}`} className="text-[13px]">
              {r.title}
            </Link>
          ),
          value: r.failed.count,
          display: r.failed.count,
          title: `${r.title}: did not answer ${r.failed.count} asks`,
        }))}
      />
      <Table>
        <THead>
          <TR>
            <TH>Document</TH>
            <TH>Kind</TH>
            <TH>Service</TH>
            <TH className="text-right">Did not answer</TH>
            <TH className="text-right">Answered</TH>
          </TR>
        </THead>
        <TBody>
          {d.rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link href={`/docs/${r.id}`}>{r.title}</Link>
                <span className="block font-mono text-[11px] text-muted">{r.id}</span>
              </TD>
              <TD className="text-[13px]">{r.kind.replace("_", " ")}</TD>
              <TD className="font-mono text-[12px]">{r.service ?? "none"}</TD>
              <TD className="text-right font-mono text-[12px]">{r.failed.count}</TD>
              <TD className="text-right font-mono text-[12px]">{r.answered.shown ? r.answered.count : <Suppressed short />}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {d.hiddenDocs ? (
        <p className="text-[12px] text-muted">
          {d.hiddenDocs} more {d.hiddenDocs === 1 ? "document has" : "documents have"} verdicts, each from fewer than {K_MIN_ASKS} asks, so they are not listed.
        </p>
      ) : null}
    </div>
  );
}

async function Load({ data }: { data: Loaded<LoadPanel> }) {
  const d = await data;
  if (isFailed(d)) return <PanelError f={d} />;
  if (d.state !== "shown" || !d.total.shown) return <NotEnough />;
  const items = [
    ...d.top.map((r) => ({
      key: r.id,
      label: (
        <Link href={`/directory/${r.id}`} className="text-[13px]">
          {r.name}
          <span className="text-muted">, {r.team}</span>
        </Link>
      ),
      value: r.count.count,
      display: `${r.count.count} (${pct(r.share)})`,
      title: `${r.name}: ${r.count.count} asks, ${pct(r.share)} of all`,
    })),
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <dl className="grid grid-cols-1 border border-line sm:grid-cols-3">
        {[
          ["Asks sent to people", String(d.total.count)],
          ["Top 3 recipients received", pct(d.top3Share)],
          ["People who absorb half", `${d.halfBy} of ${d.people}`],
        ].map(([k, v]) => (
          <div key={k} className="border-b border-line px-4 py-3 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
            <dt className="text-[12px] text-muted">{k}</dt>
            <dd className="font-mono text-xl">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 id="concentration" className="mb-2 text-sm font-semibold">
          Concentration
        </h3>
        <ConcentrationCurve curve={d.curve} people={d.people} marks={[{ at: 3, label: `top 3: ${pct(d.top3Share)}` }, { at: d.halfBy, label: `${d.halfBy} people: half of all asks` }]} />
      </div>
      <div>
        <h3 id="most-asked-people" className="mb-2 text-sm font-semibold">
          Most asked people
        </h3>
        <BarList items={items} />
        <p className="mt-2 text-[13px]">
          Everyone else: <span className="font-mono">{d.rest.people}</span> people shared {d.rest.count.shown ? <span className="font-mono">{d.rest.count.count}</span> : "the rest of the"} asks (
          <span className="font-mono">{pct(d.rest.share)}</span>).
        </p>
        <p className="mt-2 text-[12px] text-muted">People are named only when at least {K_MIN_ASKS} asks were sent to them. Askers are never shown.</p>
      </div>
    </div>
  );
}
