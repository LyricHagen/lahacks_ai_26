import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { DocQuote } from "@/components/ask/doc-quote";
import { Shortlist } from "@/components/ask/shortlist";
import { UnderstandingSummary } from "@/components/ask/understanding-summary";
import { StripSlot } from "@/components/availability/strip-slot";
import { WeekStripSkeleton } from "@/components/availability/week-strip";
import { ReadOnlyMock } from "@/components/demo/read-only-mock";
import { DemoSendPanel } from "@/components/demo/send-panel";
import { NotInDemo, PrevNext, StepNav } from "@/components/demo/step-frame";
import { Container, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { getAskExamples } from "@/lib/ask-examples";
import { URGENCY_LABEL } from "@/lib/ask-state";
import { ASK_BODY_MAX, ASK_BODY_MIN, ASK_EXTRA_MAX } from "@/lib/asks";
import { getSessionUser } from "@/lib/auth";
import { loadWeekStrips } from "@/lib/availability";
import { clockLabel } from "@/lib/clock";
import { ensureDemoState } from "@/lib/demo";
import { DEMO_PERSONA_PRONOUNS, DEMO_STEP_ALIASES, DEMO_STEPS, demoStep, demoStepHref, type DemoStepSlug } from "@/lib/demo-script";
import { type GuidedView, getGuidedView } from "@/lib/demo-view";
import { DRAFT_VARIANTS, FORMAT_LABEL, VARIANT_DEF } from "@/lib/draft";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";
import { getViewer } from "@/lib/viewer";
import { Composer } from "../../ask/new/composer";

export const metadata = { title: "Guided demo" };

const log = createLogger("page.demo.step");

type Ctx = { v: GuidedView; inDemo: boolean };

const first = (name: string) => name.split(" ")[0];

/** One week strip per ranked person, streaming in at the ranking's own clock (same as the ask page). */
function stripsFor(v: GuidedView): Record<string, ReactNode> | undefined {
  if (!v.ranking) return undefined;
  const ids = v.ranking.people.filter((p) => !p.features.excluded).map((p) => p.features.employeeId);
  const now = v.ranking.summary.clock?.now ? new Date(v.ranking.summary.clock.now) : v.clock.now;
  const promise = loadWeekStrips(v.askId, ids, now).catch((err: unknown) => {
    log.error(`${v.askId} week strips failed`, { err, askId: v.askId, code: "AVAILABILITY_FAILED" });
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

function Missing({ what }: { what: string }) {
  return <ErrorState title={`The guided ask has no ${what}`} code="DEMO_NOT_READY" body="Press Reset demo in the banner at the top to rebuild it." />;
}

/** A numbered part of a step: a short heading, one plain sentence, then the real component. */
function Part({ n, title, line, children }: { n: number; title: string; line: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`part-${n}`} className="grid gap-3 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div className="grid gap-1">
        <h2 id={`part-${n}`} className="flex items-baseline gap-2 text-[17px] font-semibold">
          <span className="font-mono text-[13px] text-muted">{n}</span>
          {title}
        </h2>
        <p className="max-w-[70ch] text-muted">{line}</p>
      </div>
      {children}
    </section>
  );
}

const he = DEMO_PERSONA_PRONOUNS;
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

function AskStep({ v }: Ctx) {
  const name = v.persona ? first(v.persona.name) : "The new hire";
  return (
    <div className="grid gap-8">
      <Part n={1} title={`${cap(he.subject)} types the problem`} line={`${name} is ${v.persona?.daysIn ?? "a few"} days into the job and does not know who owns what yet. No forms, no tags: just the problem.`}>
        <div className="grid gap-2 border border-line bg-raised px-4 py-3 text-sm">
          <p className="whitespace-pre-wrap text-[15px]">{v.body}</p>
          {v.tried ? (
            <p className="text-muted">
              <span className="font-medium text-fg">Tried:</span> {v.tried}
            </p>
          ) : null}
          <p className="text-muted">
            <span className="font-medium text-fg">How stuck:</span> {URGENCY_LABEL[v.urgency]}
          </p>
        </div>
      </Part>
      <Part n={2} title="Altostratus reads it" line={`It pulls out the service, skills and error as chips ${he.subject} can fix before anyone is searched.`}>
        {v.u ? (
          <div className="border border-line bg-raised px-4 py-3">
            <UnderstandingSummary u={v.u} />
          </div>
        ) : (
          <Missing what="understanding" />
        )}
      </Part>
      <Part n={3} title="Docs come first" line={`The best ask is one nobody has to answer. This runbook came close but does not cover the crash, so ${he.subject} asked for a person.`}>
        {v.docs.length ? (
          <div className="grid gap-3">
            {v.docs.map((d) => (
              <DocQuote key={d.documentId} doc={d} />
            ))}
          </div>
        ) : (
          <Missing what="document check" />
        )}
      </Part>
    </div>
  );
}

function MatchStep({ v }: Ctx) {
  if (!v.ranking) return <Missing what="ranking" />;
  const whyNot = v.ranking.summary.whyNot;
  const primary = v.service?.primary;
  return (
    <div className="grid gap-8">
      <Part n={1} title="The obvious expert is skipped" line="Altostratus does not pile more asks onto someone already at their weekly limit, and it says so.">
        {whyNot ? (
          <div className="border border-line-strong bg-sunken px-4 py-3" data-why-not={whyNot.employeeId}>
            <p className="text-[13px] font-semibold">Why not {primary && primary.id === whyNot.employeeId ? primary.firstName : "the owner"}?</p>
            <p className="mt-1 text-[15px]">{whyNot.text}</p>
          </div>
        ) : (
          <p className="text-sm text-muted">Nobody had to be skipped on this ask.</p>
        )}
      </Part>
      <Part n={2} title="The shortlist" line="Ranked by code from evidence: ownership, past work, free time and current load. Open a row to see the score.">
        <Shortlist askId={v.askId} view={v.ranking} canChoose={false} strips={stripsFor(v)} compact />
      </Part>
    </div>
  );
}

function MessageStep({ v, inDemo }: Ctx) {
  const d = v.draft;
  if (!d || !v.service) return <Missing what="draft" />;
  const s = d.summary;
  const name = v.persona ? first(v.persona.name) : "The asker";
  const variant = s.sent?.variant ?? s.suggested.variant;
  const m = d.messages[variant];
  const others = DRAFT_VARIANTS.filter((x) => x !== variant).map((x) => VARIANT_DEF[x].label);
  const grounded = DRAFT_VARIANTS.every((x) => s.grounding[x].ok);
  const people = { asker: { name: v.persona?.name ?? "You" }, recipient: { name: s.recipient.name, slackHandle: s.recipient.slackHandle, email: s.recipient.email } };
  const recipientLoad = v.ranking?.people.find((p) => p.features.employeeId === s.recipient.id);
  const max = s.sent?.max ?? recipientLoad?.features.load.max ?? 0;
  const loadNow = s.recipient.id === v.service.secondary.id ? v.service.secondary.load : (recipientLoad?.features.load.count ?? 0);
  return (
    <div className="grid gap-8">
      <Part
        n={1}
        title={`A draft for ${s.recipient.firstName}`}
        line={`Written only from the confirmed ask and the evidence${grounded ? ", and every name in it checked" : ""}. Altostratus never sends anything.`}
      >
        <div className="grid gap-2 lg:max-w-2xl">
          <ReadOnlyMock {...people} format={m.format} subject={m.subject} body={m.body} when={s.input.slot?.label ?? null} statusLabel={s.sent ? "Sent" : "Draft"} />
          <p className="text-[13px] text-muted">
            {VARIANT_DEF[variant].label}, as {FORMAT_LABEL[m.format]}. Also drafted: {others.join(" and ")}
            {inDemo ? (
              <>
                {" "}
                (<Link href={`/ask/${v.askId}/draft/${variant}`}>edit and copy</Link>)
              </>
            ) : null}
            .
          </p>
        </div>
      </Part>
      <Part n={2} title={`${name} sends it ${he.object}self`} line={`Then ${he.subject} clicks I sent this. ${s.recipient.firstName}'s weekly count goes up, which is what keeps the next asker from piling on.`}>
        <DemoSendPanel
          askId={v.askId}
          recipient={{ id: s.recipient.id, name: s.recipient.name, firstName: s.recipient.firstName }}
          max={max}
          loadNow={loadNow}
          sent={s.sent ? { loadBefore: s.sent.loadBefore, loadAfter: s.sent.loadAfter } : null}
          message={{ variant, format: s.sent?.format ?? m.format, subject: m.subject, body: m.body }}
          canSend={inDemo && v.status === "ready"}
          serviceName={v.service.name}
        />
      </Part>
    </div>
  );
}

async function TryStep({ inDemo, v }: Ctx) {
  const examples = await getAskExamples();
  return (
    <div className="grid gap-4">
      <p className="max-w-[70ch] text-muted">
        Type any problem, or start from an example. You are asking as {inDemo ? (v.persona?.name ?? "the demo new hire") : "a signed-out visitor"}. Afterwards, look at the{" "}
        <Link href="/dashboard">dashboard</Link>, the <Link href="/ramp">ramp plan</Link> and <Link href="/insights">insights</Link>.
      </p>
      <Composer examples={examples} limits={{ bodyMin: ASK_BODY_MIN, bodyMax: ASK_BODY_MAX, extraMax: ASK_EXTRA_MAX }} />
    </div>
  );
}

const STEP_BODY: Record<DemoStepSlug, (c: Ctx) => ReactNode | Promise<ReactNode>> = {
  ask: AskStep,
  match: MatchStep,
  message: MessageStep,
  try: TryStep,
};

export default async function Page({ params }: { params: Promise<{ step: string }> }) {
  const { step: slug } = await params;
  return withPage("demo.step", async () => {
    const alias = DEMO_STEP_ALIASES[slug];
    if (alias) {
      log.branch(`redirect /demo/${slug} to /demo/${alias}`, "an address from the eight step demo, now merged into a shorter one");
      redirect(demoStepHref(alias));
    }
    const s = demoStep(slug);
    if (!s) {
      log.branch("render 404", `no guided step "${slug}"`);
      notFound();
    }
    const [viewer, user] = await Promise.all([getViewer(), getSessionUser()]);
    let v: GuidedView;
    try {
      const state = await ensureDemoState(`viewing /demo/${slug}`);
      v = await getGuidedView(state, viewer);
    } catch (err) {
      if (err instanceof AppError && (err.code === "DEMO_NOT_READY" || err.code === "DEMO_RESET_BUSY")) {
        log.branch("render demo error state", `${err.code}: ${err.message}`);
        return (
          <Container className="max-w-4xl">
            <PageHeader eyebrow={`/demo/${slug}`} title={s.step.title} />
            <ErrorState title={err.code === "DEMO_RESET_BUSY" ? "The demo is being reset" : "The demo is not ready"} code={err.code} body={err.message} />
          </Container>
        );
      }
      throw err;
    }
    const inDemo = !!user?.isDemo;
    log.info(`guided step ${s.n} ${slug} for ${viewer.actorId}${inDemo ? " (demo account)" : " (outside the demo)"}, guided ${v.askId} in ${v.status}`);
    const body = await STEP_BODY[s.step.slug]({ v, inDemo });
    return (
      <Container className="max-w-5xl">
        <PageHeader
          eyebrow={`/demo/${slug}`}
          title={s.step.title}
          description={
            <>
              Step {s.n} of {DEMO_STEPS.length}. Demo clock: <span className="font-mono">{clockLabel(v.clock.now)}</span>.
            </>
          }
          actions={
            inDemo && slug !== "try" ? (
              <ButtonLink href={`/ask/${v.askId}`} size="sm" variant="ghost">
                Open the ask
              </ButtonLink>
            ) : undefined
          }
        />
        <StepNav current={slug} />
        {inDemo ? null : <NotInDemo path={`/demo/${slug}`} persona={v.persona?.name ?? null} />}
        {body}
        <PrevNext prev={s.prev} next={s.next} />
      </Container>
    );
  });
}
