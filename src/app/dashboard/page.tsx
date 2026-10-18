import { wallMs } from "@/lib/clock";
import Link from "next/link";
import { Suspense } from "react";
import { AskStateBadge } from "@/components/ask/state-badge";
import { Container, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { getPersonaSummary } from "@/lib/accounts";
import { ASK_STATE_DEFS, progressSteps, URGENCY_LABEL } from "@/lib/ask-state";
import { listViewerAsks } from "@/lib/asks";
import { attentionFor, RECENT_DAYS, type RecentPeople, recentRecipients } from "@/lib/dashboard";
import { Badge } from "@/components/ui/badge";
import { SkeletonLine, SkeletonList } from "@/components/ui/skeleton";
import { rampSummary } from "@/lib/ramp";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { CHANNEL_LABEL, getProfile, nextStep } from "@/lib/onboarding";
import { withPage } from "@/lib/request-context";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Dashboard" };

const log = createLogger("page.dashboard");

function ago(d: Date): string {
  const s = Math.max(0, Math.round((wallMs() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default async function Page() {
  return withPage("dashboard", async () => {
    const viewer = await getViewer();
    const [persona, asks, profile] = await Promise.all([getPersonaSummary(viewer.personaId), listViewerAsks(viewer), viewer.user ? getProfile(viewer.user.id) : Promise.resolve(null)]);
    const onboardingNext = viewer.user ? nextStep(profile) : null;
    const attention = await attentionFor(asks.open);
    const openSorted = [...asks.open].sort((a, b) => Number(!!attention[b.id]) - Number(!!attention[a.id]));
    // Started here so their log lines keep this request id while they stream in.
    const ramp = rampSummary(viewer).catch((err) => {
      log.error("ramp line failed", { err, code: toAppError(err).code });
      return "failed" as const;
    });
    const people = recentRecipients(viewer).catch((err) => {
      log.error("recent recipients failed", { err, code: toAppError(err).code });
      return "failed" as const;
    });
    if (onboardingNext) log.branch("show the finish-setup notice", `onboarding next step is ${onboardingNext}`);
    log.info(`dashboard for ${viewer.actorId}: ${asks.open.length} open, ${asks.closed.length} closed, ${asks.activity.length} recent events`);
    const empty = asks.open.length === 0 && asks.closed.length === 0;
    if (empty) log.branch("render empty state", "viewer has made no asks yet");

    return (
      <Container>
        <PageHeader
          eyebrow="/dashboard"
          title={persona ? `Hi, ${persona.name.split(" ")[0]}` : "Dashboard"}
          description={viewer.user ? "Your open asks and what happened to them." : "You are browsing as the demo persona. Asks you make here are kept for this browser."}
          actions={
            <ButtonLink href="/ask/new" variant="primary">
              New ask
            </ButtonLink>
          }
        />

        <Suspense fallback={<SkeletonLine width="22rem" className="mb-8 h-4" />}>
          <RampLine summary={ramp} />
        </Suspense>

        {onboardingNext ? (
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border border-accent bg-accent-soft px-4 py-3 text-sm">
            <p>
              <span className="font-semibold">Finish setting up.</span> Three short steps so suggestions fit you. Skippable.
            </p>
            <ButtonLink href={`/onboarding/${onboardingNext}`} size="sm">
              Continue setup
            </ButtonLink>
          </div>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div className="flex min-w-0 flex-col gap-8">
            {empty ? (
              <EmptyState
                title="No asks yet"
                body="Describe what you are stuck on in your own words. Who2Ask finds the right colleague, says why, and drafts the message for you to send. Not sure where to start? The guided demo walks through one."
                action={
                  <>
                    <ButtonLink href="/ask/new" variant="primary">
                      Ask your first question
                    </ButtonLink>
                    <ButtonLink href="/demo">Watch the guided demo</ButtonLink>
                  </>
                }
              />
            ) : (
              <section>
                <h2 className="mb-3 text-[15px] font-semibold">
                  Open asks <span className="font-mono text-[12px] text-muted">{asks.open.length}</span>
                  {Object.keys(attention).length ? <span className="ml-2 text-[13px] font-normal text-muted">{Object.keys(attention).length} need you</span> : null}
                </h2>
                {asks.open.length ? (
                  <ul className="border border-line bg-raised">
                    {openSorted.map((a) => {
                      const p = progressSteps(a.status);
                      const need = attention[a.id];
                      return (
                        <li key={a.id} className="border-b border-line px-4 py-3 last:border-b-0" data-attention={need?.kind}>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <Link href={`/ask/${a.id}`} className="min-w-0 font-medium">
                              {a.title}
                            </Link>
                            <span className="font-mono text-[12px] text-muted">
                              opened {ago(a.createdAt)}, updated {ago(a.updatedAt)}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                            <AskStateBadge state={a.status} />
                            <span className="font-mono text-[12px]">
                              {a.id}, step {p.index} of {p.total}
                            </span>
                            <span>{URGENCY_LABEL[a.urgency]}</span>
                            {ASK_STATE_DEFS[a.status].phase === "processing" && a.progress ? <span className="font-mono text-[12px]">{a.progress}</span> : null}
                          </div>
                          {need ? (
                            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
                              <Badge tone={need.kind === "waiting_on_you" ? "neutral" : "accent"}>{need.kind === "stale" ? "Stale" : need.kind === "overdue" ? "Overdue" : "Waiting on you"}</Badge>
                              <Link href={`/ask/${a.id}`}>{need.label}</Link>
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <EmptyState title="Nothing open" body="Every ask is answered or abandoned." action={<ButtonLink href="/ask/new">New ask</ButtonLink>} />
                )}
              </section>
            )}

            {asks.activity.length ? (
              <section>
                <h2 className="mb-3 text-[15px] font-semibold">Recent activity</h2>
                <ol className="border border-line">
                  {asks.activity.map((e) => (
                    <li key={e.id} className="grid gap-x-4 border-b border-line px-4 py-2 text-[13px] last:border-b-0 sm:grid-cols-[6rem_1fr]">
                      <span className="font-mono text-[12px] text-muted">{ago(e.at)}</span>
                      <span className="min-w-0">
                        <Link href={`/ask/${e.askId}`} className="font-mono text-[12px]">
                          {e.askId}
                        </Link>{" "}
                        {e.kind === "transition" ? (
                          <>
                            {e.fromState ? ASK_STATE_DEFS[e.fromState].label : "new"} to <span className="font-medium">{e.toState ? ASK_STATE_DEFS[e.toState].label : "?"}</span>
                          </>
                        ) : (
                          e.kind.replace(/_/g, " ")
                        )}
                        <span className="text-muted">
                          {" "}
                          by {e.actor}
                          {e.reason ? `: ${e.reason}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {asks.closed.length ? (
              <section>
                <h2 className="mb-3 text-[15px] font-semibold">
                  Closed <span className="font-mono text-[12px] text-muted">{asks.closed.length}</span>
                </h2>
                <ul className="border border-line">
                  {asks.closed.slice(0, 10).map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2 text-sm last:border-b-0">
                      <Link href={`/ask/${a.id}`} className="min-w-0">
                        {a.title}
                      </Link>
                      <AskStateBadge state={a.status} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <aside className="flex min-w-0 flex-col gap-6">
            <Suspense fallback={<SkeletonList count={3} />}>
              <RecentPeopleCard people={people} />
            </Suspense>
            <Card>
              <CardHeader title="You are playing" meta={viewer.user ? undefined : "Demo persona for signed-out visitors"} />
              <CardBody className="text-sm">
                {persona ? (
                  <>
                    <p>
                      <Link href={`/directory/${persona.id}`} className="font-medium">
                        {persona.name}
                      </Link>
                    </p>
                    <p className="text-muted">
                      {persona.title}, {persona.team}
                    </p>
                    {persona.managerName ? <p className="mt-1 text-muted">Reports to {persona.managerName}</p> : null}
                  </>
                ) : (
                  <p className="text-muted">No persona. The company may not be seeded.</p>
                )}
                {profile?.completedAt ? (
                  <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1 border-t border-line pt-3 text-[13px]">
                    <dt className="text-muted">Reach people by</dt>
                    <dd>{CHANNEL_LABEL[profile.preferredChannel]}</dd>
                    <dt className="text-muted">Senior people</dt>
                    <dd>{profile.okToInterruptSeniors ? "OK to interrupt" : "Peers first"}</dd>
                    <dt className="text-muted">Known skills</dt>
                    <dd className="font-mono">{profile.knownSkillIds.length}</dd>
                  </dl>
                ) : null}
                <p className="mt-4 text-[13px]">
                  {viewer.user ? <Link href="/onboarding/role">Change persona or preferences</Link> : <Link href="/signup">Sign up to play your own persona</Link>}
                </p>
              </CardBody>
            </Card>
          </aside>
        </div>
      </Container>
    );
  });
}

async function RampLine({ summary }: { summary: Promise<Awaited<ReturnType<typeof rampSummary>> | "failed"> }) {
  const r = await summary;
  if (r === "failed") return <p className="mb-8 font-mono text-[12px] text-danger">RAMP_FAILED: the ramp line could not load</p>;
  if (!r) return null;
  const days = r.daysIn !== null ? `You are ${r.daysIn} days in.` : null;
  const body = r.plan
    ? `This week's ramp plan: ${r.plan.learn} things to learn${r.plan.stretch ? ", a stretch task" : ""}${r.plan.meet ? " and someone to meet" : ""}.`
    : r.asks >= r.need
      ? `Your asks are enough for a ramp plan this week (${r.asks} so far).`
      : `A ramp plan needs ${r.need} asks; you have ${r.asks}.`;
  return (
    <p className="mb-8 border-b border-line pb-4 text-sm">
      {days ? <span className="font-semibold">{days}</span> : null} {body} <Link href="/ramp">Open the ramp plan</Link>
    </p>
  );
}

async function RecentPeopleCard({ people }: { people: Promise<RecentPeople | "failed"> }) {
  const r = await people;
  if (r === "failed") return <p className="font-mono text-[12px] text-danger">DB_QUERY_FAILED: recent people could not load</p>;
  return (
    <Card>
      <CardHeader title="Who you asked recently" meta={`Last ${RECENT_DAYS} days, by messages you sent`} />
      {r.people.length ? (
        <>
          <ul>
            {r.people.slice(0, 6).map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2 text-[13px] last:border-b-0">
                <span className="min-w-0">
                  <Link href={`/directory/${p.id}`} className="font-medium">
                    {p.name}
                  </Link>
                  <span className="block truncate text-[12px] text-muted">
                    {p.title}, {p.team}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12px] text-muted">
                  {p.count}x, last <Link href={`/ask/${p.lastAskId}`}>{p.lastAskId}</Link>
                </span>
              </li>
            ))}
          </ul>
          {r.repeat ? (
            <CardBody className="border-t border-line text-[13px] text-muted">
              {r.repeat.count} of your last {r.repeat.total} asks went to {r.repeat.name.split(" ")[0]}. It may be worth spreading them: the shortlist on your next ask names
              others who know the same systems, and <Link href="/ramp">your ramp plan</Link> suggests someone new to meet.
            </CardBody>
          ) : null}
        </>
      ) : (
        <CardBody className="text-[13px] text-muted">Nobody yet. People show up here after you click &quot;I sent this&quot; on a draft.</CardBody>
      )}
    </Card>
  );
}
