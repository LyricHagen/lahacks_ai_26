// /ramp and /ramp/next: one week of the ramp plan. The plan is built inside withPage (so its log
// lines keep the request id) and streams in behind RampSkeleton.

import Link from "next/link";
import { Suspense } from "react";
import { Container, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonCard, SkeletonLine } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { toAppError } from "@/lib/errors";
import { createLogger, currentReqId } from "@/lib/log";
import { getRampView, type RampView } from "@/lib/ramp";
import { RAMP_SECTION_LABEL, type RampItem, type RampPlanReady, type RampWeek } from "@/lib/ramp-types";
import { withPage } from "@/lib/request-context";
import { formatDay } from "@/lib/time";
import { RampItemControls } from "./ramp-controls";

const log = createLogger("page.ramp");

type Failed = { failed: true; code: string; reqId: string | null };

export async function RampPage({ week }: { week: RampWeek }) {
  return withPage(week === "this" ? "ramp" : "ramp.next", async () => {
    const view: Promise<RampView | Failed> = getRampView(week).catch((err) => {
      const e = toAppError(err, "RAMP_FAILED");
      log.error(`ramp plan for week ${week} failed with ${e.code}`, { err });
      return { failed: true as const, code: e.code === "UNKNOWN" ? "RAMP_FAILED" : e.code, reqId: currentReqId() };
    });
    return (
      <Container>
        <PageHeader
          eyebrow={week === "this" ? "/ramp" : "/ramp/next"}
          title="Ramp plan"
          description="What to learn, one stretch task and one person to meet, built only from your own asks and the company directory."
          actions={<ButtonLink href="/ask/new">New ask</ButtonLink>}
        />
        <Tabs
          label="Plan week"
          className="mb-8"
          items={[
            { href: "/ramp", label: "This week" },
            { href: "/ramp/next", label: "Next week" },
          ]}
        />
        <Suspense fallback={<RampSkeleton />}>
          <RampBody view={view} week={week} />
        </Suspense>
      </Container>
    );
  });
}

export function RampSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]" role="status" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-6">
        <SkeletonLine width="40%" className="h-5" />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </div>
      <div className="flex flex-col gap-3">
        <SkeletonLine width="60%" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}

async function RampBody({ view, week }: { view: Promise<RampView | Failed>; week: RampWeek }) {
  const v = await view;
  if ("failed" in v) return <ErrorState title="The ramp plan could not be built" code={v.code} reqId={v.reqId} />;
  if (!v.plan) return <ErrorState title="No company to plan in" code="SEED_EMPTY" body="The synthetic company is not seeded yet." />;
  const p = v.plan;
  const persona = `${p.persona.name}${p.persona.daysIn !== null ? `, ${p.persona.daysIn} days in` : ""} on the ${p.persona.team} team`;
  const weekLine = (
    <p className="mb-6 text-sm text-muted">
      <span className="font-semibold text-fg">Week of {formatDay(p.weekStart)}</span> for {persona}.{" "}
      {week === "next" ? "A preview: anything you dismiss on this week's plan is already left out here." : v.clockPinned ? "Demo clock: the week is fixed to the seeded calendar." : null}
    </p>
  );

  if (p.status === "not_enough_history") {
    return (
      <div className="max-w-2xl">
        {weekLine}
        <section className="border border-line-strong bg-raised px-5 py-5" aria-labelledby="no-plan">
          <h2 id="no-plan" className="text-lg font-semibold">
            Not enough history for a plan yet
          </h2>
          <p className="mt-2 text-sm">{p.reason}</p>
          <p className="mt-3 font-mono text-[13px]">
            {p.history.asks} of {p.need} asks
          </p>
          <p className="mt-3 text-sm text-muted">
            We would rather show nothing than a generic list. Once your asks show which systems you keep running into, the plan points at real documents, colleagues and projects
            for them.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/ask/new" variant="primary">
              Ask about what you are stuck on
            </ButtonLink>
            <ButtonLink href="/dashboard">Your asks</ButtonLink>
          </div>
        </section>
      </div>
    );
  }

  const readOnly = week === "next";
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-10">
        <div>
          {weekLine}
          {p.note ? <p className="mb-2 border border-line bg-sunken px-3 py-2 text-[13px] text-muted">{p.note}</p> : null}
        </div>
        <Section title={RAMP_SECTION_LABEL.learn} count={p.learn.length} missing={p.missing.learn}>
          {p.learn.map((i) => (
            <Item key={i.refId} item={i} plan={p} dismissed={v.dismissed.has(i.refId)} readOnly={readOnly} />
          ))}
        </Section>
        <Section title={RAMP_SECTION_LABEL.stretch} count={p.stretch ? 1 : 0} missing={p.missing.stretch}>
          {p.stretch ? <Item item={p.stretch} plan={p} dismissed={v.dismissed.has(p.stretch.refId)} readOnly={readOnly} /> : null}
        </Section>
        <Section title={RAMP_SECTION_LABEL.meet} count={p.meet ? 1 : 0} missing={p.missing.meet}>
          {p.meet ? <Item item={p.meet} plan={p} dismissed={v.dismissed.has(p.meet.refId)} readOnly={readOnly} /> : null}
        </Section>
        {p.leftOut.length ? (
          <p className="text-[13px] text-muted">
            Left out because you dismissed {p.leftOut.length === 1 ? "it" : "them"}:{" "}
            {p.leftOut.map((r, k) => (
              <span key={r}>
                {k ? ", " : ""}
                <span className="font-mono">{r}</span>
              </span>
            ))}
            .
          </p>
        ) : null}
      </div>
      <aside className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader title="What your asks point at" meta={`From ${p.history.asks} asks past the confirm step`} />
          <CardBody className="flex flex-col gap-4">
            {p.gaps.map((g) => (
              <div key={g.skillId}>
                <p className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                  {g.name}
                  <span className="font-mono text-[12px] font-normal text-muted">score {g.score}</span>
                </p>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-muted">
                  {g.signals.map((s) => (
                    <li key={s}>
                      <Linked text={s} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardBody>
        </Card>
        <div className="text-[12px] text-muted">
          <p className="mb-1 font-semibold text-fg">How this plan is made</p>
          <p>
            Code finds the gaps from your asks, the services they touch and your team&apos;s core skills, and picks a few real rows for each part. One model call chooses among
            them and writes the sentences; any sentence with a fact not in those rows is replaced. Dismissing an item keeps it out of later plans and lowers its skill.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, count, missing, children }: { title: string; count: number; missing?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 id={title.toLowerCase().replace(/\s+/g, "-")} className="mb-3 text-lg font-semibold">
        {title} <span className="font-mono text-[12px] font-normal text-muted">{count}</span>
      </h2>
      {count ? <div className="flex flex-col gap-4">{children}</div> : <p className="border border-dashed border-line-strong px-4 py-3 text-sm text-muted">{missing ?? "Nothing to suggest here this week."}</p>}
    </section>
  );
}

const KIND_LABEL: Record<RampItem["refKind"], string> = { document: "Document", employee: "Colleague", project: "Project" };

function Item({ item, plan, dismissed, readOnly }: { item: RampItem; plan: RampPlanReady; dismissed: boolean; readOnly: boolean }) {
  return (
    <article className={dismissed ? "border border-dashed border-line-strong bg-bg" : "border border-line bg-raised"} data-ref={item.refId}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted">
            {KIND_LABEL[item.refKind]}
            {item.skillName ? `, for ${item.skillName}` : ""}
          </p>
          <h3 className={dismissed ? "text-[15px] font-semibold text-muted line-through" : "text-[15px] font-semibold"}>
            <Link href={item.href}>{item.title}</Link> <span className="font-mono text-[12px] font-normal text-muted">{item.refId}</span>
          </h3>
          <p className="text-[13px] text-muted">{item.subtitle}</p>
        </div>
        {item.textSource === "template" ? <Badge>Template text</Badge> : null}
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {item.task ? (
          <p className="text-sm">
            <span className="font-semibold">Task: </span>
            {item.task}
          </p>
        ) : null}
        <p className="text-sm">
          <Linked text={item.why} />
        </p>
        <details className="text-[12px] text-muted">
          <summary className="cursor-pointer">Built from {item.facts.length} facts in the company data</summary>
          <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-4">
            {item.facts.map((f) => (
              <li key={f}>
                <Linked text={f} />
              </li>
            ))}
          </ul>
        </details>
        <RampItemControls weekStart={plan.weekStart} refId={item.refId} title={item.title} dismissed={dismissed} readOnly={readOnly} />
      </div>
    </article>
  );
}

/** Ask ids in a sentence become links to the ask, so every reason leads back to its row. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(ask_\d+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^ask_\d+$/.test(part) ? (
          <Link key={i} href={`/ask/${part}`} className="font-mono">
            {part}
          </Link>
        ) : (
          part
        ),
      )}
    </>
  );
}
