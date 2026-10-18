import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { AbandonButton, RetryButton } from "@/components/ask/ask-controls";
import { AskHistory } from "@/components/ask/ask-history";
import { AskProgress } from "@/components/ask/ask-progress";
import { LiveStatus } from "@/components/ask/live-status";
import { NotBuiltPanel } from "@/components/ask/not-built";
import { CandidateList } from "@/components/ask/candidate-list";
import { ConfirmPanel } from "@/components/ask/confirm-panel";
import { FollowUpCard } from "@/components/ask/follow-up";
import { DocQuote } from "@/components/ask/doc-quote";
import { RetrievalCounts } from "@/components/ask/retrieval-counts";
import { Shortlist } from "@/components/ask/shortlist";
import { AskStateBadge } from "@/components/ask/state-badge";
import { StripSlot } from "@/components/availability/strip-slot";
import { WeekStripSkeleton } from "@/components/availability/week-strip";
import { UnderstandingSummary } from "@/components/ask/understanding-summary";
import { Container, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { stepBuilt } from "@/lib/ask-pipeline";
import { type AskState, ASK_STATE_DEFS, isOpen, URGENCY_LABEL } from "@/lib/ask-state";
import { type FollowUp, followUpFor } from "@/lib/ask-outcome";
import { asRetrieval, type CandidateView, type DocCheckView, type DraftView, getCandidates, getDocChecks, getDraftView, getRanking, type RankingView } from "@/lib/ask-review";
import { FORMAT_LABEL, VARIANT_DEF } from "@/lib/draft";
import { type AskDetail, getAskDetail } from "@/lib/asks";
import { loadWeekStrips } from "@/lib/availability";
import { getClock } from "@/lib/clock-request";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import type { RetrievalSummary } from "@/lib/retrieval-paths";
import { withPage } from "@/lib/request-context";
import { loadCatalog, protectUnderstanding } from "@/lib/understand-build";
import { normalizeUnderstanding, type Understanding } from "@/lib/understanding";

export const metadata = { title: "Ask" };

const log = createLogger("page.ask.detail");

/** Everything the panels need beyond the ask row: loaded once per render. */
type Work = {
  u: Understanding | null;
  docs: DocCheckView[];
  candidates: CandidateView[];
  retrieval: RetrievalSummary | null;
  ranking: RankingView | null;
  /** One week strip per eligible ranked person, each streaming in behind its own skeleton. */
  strips: Record<string, ReactNode> | undefined;
  catalog: { services: Array<{ id: string; name: string }>; skills: Array<{ id: string; name: string }> } | null;
  draft: DraftView | null;
  followUp: FollowUp | null;
};

/** The message as it went out (or the suggested draft before), read only. */
function SentMessage({ d, w, title }: { d: AskDetail; w: Work; title: string }) {
  if (!w.draft) return null;
  const s = w.draft.summary;
  const v = s.sent?.variant ?? s.suggested.variant;
  const m = w.draft.messages[v];
  return (
    <div className="grid gap-2 border border-line bg-sunken px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="font-mono text-[12px] text-muted">
          {VARIANT_DEF[v].label}, {FORMAT_LABEL[s.sent?.format ?? m.format]}, {s.sent?.words ?? m.body.split(/\s+/).length} words
        </p>
      </div>
      {m.subject && (s.sent?.format ?? m.format) !== "slack" ? <p className="text-sm font-medium">{m.subject}</p> : null}
      <p className="whitespace-pre-wrap text-sm">{m.body}</p>
      <p className="text-[12px]">
        <Link href={`/ask/${d.ask.id}/draft/${v}`}>Open the draft</Link>
      </p>
    </div>
  );
}

/**
 * What each state shows. A state missing here (or a processing state without a pipeline step)
 * renders NotBuiltPanel, so a later prompt adds a screen by adding an entry.
 */
const PANELS: Partial<Record<AskState, (d: AskDetail, w: Work) => ReactNode>> = {
  confirming: (d, w) =>
    w.u && w.catalog ? (
      <ConfirmPanel askId={d.ask.id} u={w.u} docs={w.docs} services={w.catalog.services} skills={w.catalog.skills} canAct={d.canAct} />
    ) : (
      <ErrorState title="Nothing to confirm" code="ASK_CONFIRM_INVALID" body="This ask has no understanding stored. Abandon it and ask again." />
    ),
  shortlist: (d, w) =>
    w.ranking ? (
      <Shortlist askId={d.ask.id} view={w.ranking} canChoose={d.canAct} strips={w.strips} />
    ) : (
      <ErrorState title="No ranking stored" code="ASK_STEP_FAILED" body="This ask reached the shortlist without a stored ranking. Abandon it and ask again." />
    ),
  draft: (d) =>
    d.ask.lastErrorCode ? (
      <ErrorState
        title="A processing step failed"
        code={d.ask.lastErrorCode}
        reqId={d.ask.lastErrorReqId}
        body="The ask went back to draft. Nothing you wrote was lost."
        action={d.canAct ? <RetryButton askId={d.ask.id} /> : undefined}
      />
    ) : (
      <div className="border border-line bg-raised px-5 py-4">
        <p className="font-semibold">Not submitted yet</p>
        <p className="mt-1 text-sm text-muted">Submit it to find who to ask.</p>
        {d.canAct ? (
          <div className="mt-3">
            <RetryButton askId={d.ask.id} label="Submit" />
          </div>
        ) : null}
      </div>
    ),
  ready: (d, w) => {
    const s = w.draft?.summary;
    if (!s) return <ErrorState title="No draft stored" code="ASK_STEP_FAILED" body="This ask is ready but has no draft. Go back to the shortlist and pick again." />;
    return (
      <div className="grid gap-3 border border-line-strong bg-raised px-5 py-4">
        <div>
          <p className="font-semibold">Your message to {s.recipient.name} is drafted, not sent</p>
          <p className="mt-1 text-sm">
            Three versions are waiting: short, full context and a call request. Edit one, copy it, and send it to {s.recipient.firstName} yourself. Then come back and say you sent it.
          </p>
        </div>
        <SentMessage d={d} w={w} title={`Suggested: ${VARIANT_DEF[s.suggested.variant].label}`} />
        <div>
          <ButtonLink href={`/ask/${d.ask.id}/draft/${s.suggested.variant}`} variant="primary">
            Open the draft
          </ButtonLink>
        </div>
      </div>
    );
  },
  sent: (d, w) => (
    <div className="grid gap-3">
      {w.followUp ? <FollowUpCard askId={d.ask.id} f={w.followUp} canAct={d.canAct} stale={false} /> : <SeededSent d={d} />}
      <SentMessage d={d} w={w} title="What you sent" />
    </div>
  ),
  stale: (d, w) => (
    <div className="grid gap-3">
      {w.followUp ? <FollowUpCard askId={d.ask.id} f={w.followUp} canAct={d.canAct} stale /> : <SeededSent d={d} />}
      <SentMessage d={d} w={w} title="What you sent" />
    </div>
  ),
  answered: (d, w) => {
    const doc = w.docs.find((x) => x.verdict === "answered");
    const by = d.ask.routedToName;
    return (
      <div className="grid gap-3">
        <div className="border border-success bg-success-soft px-5 py-4">
          <p className="font-semibold text-success">ANSWERED</p>
          <p className="mt-1 text-sm">
            {doc ? "A document answered this, so nobody had to be interrupted. The best ask is the one nobody has to answer." : by ? `${by} answered this ask.` : "This ask was answered."}
          </p>
          {!doc && d.ask.answerNote ? (
            <blockquote className="mt-3 border border-line bg-raised px-3 py-2 text-sm">
              <p className="text-[13px] text-muted">The answer, in your words</p>
              <p>{d.ask.answerNote}</p>
            </blockquote>
          ) : null}
          {!doc && d.ask.source !== "seed" ? (
            <p className="mt-3 text-[13px]">
              {d.ask.answerNote
                ? "Saved with the ask. Answers like this are how the company gets smarter: the next new hire with this question can find it without interrupting anyone."
                : "No answer was captured. A one line answer next time helps the next new hire find it without asking."}
            </p>
          ) : null}
        </div>
        {doc ? <DocQuote doc={doc} /> : null}
        {!doc ? <SentMessage d={d} w={w} title="What you sent" /> : null}
      </div>
    );
  },
  abandoned: () => (
    <div className="border border-line bg-raised px-5 py-4">
      <p className="font-semibold">Abandoned</p>
      <p className="mt-1 text-sm text-muted">This ask was dropped. It stays here for your history.</p>
      <div className="mt-3">
        <ButtonLink href="/ask/new" size="sm">
          Start a new ask
        </ButtonLink>
      </div>
    </div>
  ),
};

/** Seeded history was routed directly: no draft and no follow-up, just who it went to. */
function SeededSent({ d }: { d: AskDetail }) {
  return (
    <div className="border border-line bg-raised px-5 py-4">
      <p className="font-semibold">Sent{d.ask.routedToName ? ` to ${d.ask.routedToName}` : ""}</p>
      <p className="mt-1 text-sm text-muted">{d.ask.source === "seed" ? "Seeded history: routed directly, with no draft on record." : "Waiting for an answer."}</p>
    </div>
  );
}

/** Picks the panel for the current state. Called inside withPage so its branch line has the request id. */
function statePanel(d: AskDetail, w: Work): ReactNode {
  const state = d.ask.status;
  const def = ASK_STATE_DEFS[state];
  if (def.phase === "processing") {
    if (stepBuilt(state)) {
      log.branch(`${d.ask.id} render live status`, `${state} is processing and its step exists`, { askId: d.ask.id });
      return <LiveStatus askId={d.ask.id} initialState={state} initialProgress={d.ask.progress} canRun={d.canAct} />;
    }
    log.branch(`${d.ask.id} render not-built placeholder`, `${state} has no pipeline step yet (prompt ${def.builtInPrompt})`, { askId: d.ask.id });
    return (
      <NotBuiltPanel state={state}>
        {d.ask.progress ? <p className="font-mono text-[12px] text-muted">last status: {d.ask.progress}</p> : null}
      </NotBuiltPanel>
    );
  }
  const panel = PANELS[state];
  if (panel) {
    log.branch(`${d.ask.id} render ${state} panel`, `${state} has a screen`, { askId: d.ask.id });
    return panel(d, w);
  }
  log.branch(`${d.ask.id} render not-built placeholder`, `no screen for ${state} yet (prompt ${def.builtInPrompt})`, { askId: d.ask.id });
  return <NotBuiltPanel state={state} />;
}

/**
 * Week strips for everyone eligible (the tune control can bring any of them onto the shortlist),
 * from one query, as of the instant the ask was ranked so they agree with the stored windows and
 * channel suggestions. Asks ranked before prompt 7 have no stored clock and use this request's.
 */
async function stripsFor(askId: string, ranking: RankingView): Promise<Record<string, ReactNode>> {
  const ids = ranking.people.filter((p) => !p.features.excluded).map((p) => p.features.employeeId);
  const stored = ranking.summary.clock?.now;
  if (!stored) log.branch(`${askId} week strips at this request's clock`, "the ranking has no stored clock (ranked before prompt 7)", { askId });
  const now = stored ? new Date(stored) : (await getClock()).now;
  const promise = loadWeekStrips(askId, ids, now).catch((err: unknown) => {
    log.error(`${askId} week strips failed`, { err, askId, code: "AVAILABILITY_FAILED" });
    return null;
  });
  return Object.fromEntries(
    ids.map((id) => [
      id,
      <Suspense key={id} fallback={<WeekStripSkeleton compact legend={false} />}>
        <StripSlot promise={promise} id={id} compact legend={false} />
      </Suspense>,
    ]),
  );
}

export default async function Page({ params }: { params: Promise<{ askId: string }> }) {
  const { askId } = await params;
  return withPage("ask.detail", async () => {
    let d: AskDetail;
    try {
      d = await getAskDetail(askId);
    } catch (err) {
      if (err instanceof AppError && err.code === "ASK_NOT_FOUND") {
        log.branch("render 404", `${askId} not found or not visible to this viewer`, { askId });
        notFound();
      }
      throw err;
    }
    const { ask } = d;
    const u = normalizeUnderstanding(ask.understanding);
    // Keep sensitive spans out of every line this render logs.
    protectUnderstanding(u);
    const appAsk = ask.source !== "seed";
    const [docs, candidates, catalog, ranking] = await Promise.all([
      appAsk ? getDocChecks(ask.id) : Promise.resolve([]),
      appAsk ? getCandidates(ask.id) : Promise.resolve([]),
      ask.status === "confirming" ? loadCatalog() : Promise.resolve(null),
      appAsk && ask.ranking ? getRanking(ask.id, ask.ranking) : Promise.resolve(null),
    ]);
    if (!appAsk) log.skip(`${ask.id} doc checks and candidates`, "seeded history was routed directly, no retrieval ran");
    const retrieval = asRetrieval(ask.retrieval);
    const sentish = ask.status === "sent" || ask.status === "stale";
    const [strips, draft, followUp] = await Promise.all([
      ranking ? stripsFor(ask.id, ranking) : Promise.resolve(undefined),
      appAsk && ask.draft ? getDraftView(ask.id, ask.draft) : Promise.resolve(null),
      appAsk && sentish ? followUpFor(ask.id) : Promise.resolve(null),
    ]);
    const w: Work = {
      u,
      docs,
      candidates,
      retrieval,
      ranking,
      strips,
      draft,
      followUp,
      catalog: catalog ? { services: catalog.services.map((s) => ({ id: s.id, name: s.name })), skills: catalog.skills.map((s) => ({ id: s.id, name: s.name })) } : null,
    };
    const panel = statePanel(d, w);
    // Before ranking: the alphabetical candidate list. After: the shortlist (its own panel in
    // shortlist, read only below the current step once a person was chosen).
    const showPeople = appAsk && !ranking && retrieval?.total !== null && retrieval?.total !== undefined && ask.status !== "retrieving";
    const pastShortlist = !!ranking && ask.status !== "shortlist" && ask.status !== "ranking";
    const showUnderstanding = !!u && ask.status !== "confirming" && ask.status !== "understanding";
    const pastDocs = docs.length > 0 && ask.status !== "confirming" && !docs.some((x) => x.verdict === "answered");
    log.info(`${ask.id} rendered in state ${ask.status}`, { askId: ask.id, state: ask.status, events: d.events.length, docs: docs.length, candidates: candidates.length, ranked: ranking?.people.length ?? 0 });
    return (
      <Container className="max-w-4xl">
        <PageHeader
          eyebrow={`/ask/${ask.id}`}
          title={ask.title}
          actions={d.canAct && isOpen(ask.status) && ask.status !== "sent" ? <AbandonButton askId={ask.id} /> : undefined}
        />
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <AskStateBadge state={ask.status} />
          <span className="font-mono text-[12px] text-muted">{ask.id}</span>
          <span className="text-muted">
            {URGENCY_LABEL[ask.urgency]}
            {ask.askerName ? (
              <>
                , asked by <Link href={`/directory/${ask.askerId}`}>{ask.askerName}</Link>
              </>
            ) : null}
          </span>
          {ask.source === "seed" ? <span className="text-muted">Seeded history, read only</span> : null}
        </div>

        <AskProgress state={ask.status} className="mb-8" />

        <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
          <section aria-label="Current step">
            {panel}
          </section>

          {showPeople ? (
            <section aria-labelledby="people-h" className="grid gap-3">
              <div>
                <h2 id="people-h" className="text-[15px] font-semibold">
                  People who could help
                </h2>
                <p className="mt-1 text-[13px] text-muted">Not ranked yet: in alphabetical order, each with the evidence that brought them in. Ranking by ownership, load and availability comes next.</p>
              </div>
              <RetrievalCounts summary={retrieval} />
              <CandidateList candidates={candidates} />
            </section>
          ) : null}

          {pastShortlist && ranking ? (
            <section aria-label="Shortlist" className="border-t border-line pt-6">
              <Shortlist askId={ask.id} view={ranking} canChoose={false} strips={strips} />
            </section>
          ) : null}

          {showUnderstanding && u ? (
            <Card>
              <CardHeader title="What Altostratus understood" meta="As confirmed before the search" />
              <CardBody>
                <UnderstandingSummary u={u} />
              </CardBody>
            </Card>
          ) : null}

          {pastDocs ? (
            <section aria-labelledby="docs-past-h" className="grid gap-3">
              <h2 id="docs-past-h" className="text-[15px] font-semibold">
                Documents offered first
              </h2>
              {docs.map((x) => (
                <DocQuote key={x.documentId} doc={x} />
              ))}
            </section>
          ) : null}

          <Card>
            <CardHeader title="The ask" meta={`Created ${ask.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC`} />
            <CardBody className="grid gap-4 text-sm">
              <p className="whitespace-pre-wrap text-[15px]">{ask.body}</p>
              {ask.tried ? (
                <div>
                  <p className="text-[13px] font-medium text-muted">Already tried</p>
                  <p className="whitespace-pre-wrap">{ask.tried}</p>
                </div>
              ) : null}
              {ask.hasConfidential ? <p className="text-[13px] text-muted">A confidential note is stored with this ask. It will be left out of the draft and is not shown here.</p> : null}
            </CardBody>
          </Card>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold">History</h2>
            <AskHistory events={d.events} />
            <p className="mt-2 text-[13px] text-muted">
              Every change is logged. To follow this ask in the log, search for <span className="font-mono">{ask.id}</span>.
            </p>
          </section>
        </div>
      </Container>
    );
  });
}
