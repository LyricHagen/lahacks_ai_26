import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { PersonAvailabilityPanel, PersonAvailabilitySkeleton } from "@/components/availability/person-availability";
import { formatDate, LoadCell, SourceBadge, ZoneText } from "@/components/directory/bits";
import { WeekCalendar } from "@/components/directory/week-calendar";
import { Container, PageHeader } from "@/components/page-header";
import { Toc } from "@/components/toc";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { availabilityForPerson } from "@/lib/availability";
import { clockLabel } from "@/lib/clock";
import { getClock } from "@/lib/clock-request";
import { getPerson, LOAD_WINDOW_DAYS, type PersonDetail } from "@/lib/directory";
import { toAppError } from "@/lib/errors";
import { createLogger, currentReqId } from "@/lib/log";
import { getProfile } from "@/lib/onboarding";
import { withPage } from "@/lib/request-context";
import { getViewer } from "@/lib/viewer";

const log = createLogger("page.person");

export async function generateMetadata({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  return { title: personId };
}

function Section({ title, children, meta }: { title: string; children: ReactNode; meta?: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold tracking-tight">{title}</h2>
      {meta ? <p className="mb-3 text-sm text-muted">{meta}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

function tenure(startDate: string, now: Date): string {
  const days = Math.round((now.getTime() - Date.parse(`${startDate}T00:00:00Z`)) / 86400_000);
  if (days < 0) return "starts soon";
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

export default async function PersonPage({ params }: { params: Promise<{ personId: string }> }) {
  return withPage("directory.person", async () => {
    const { personId } = await params;
    const clock = await getClock();
    let data: PersonDetail | null;
    try {
      data = await getPerson(personId, clock.now);
    } catch (err) {
      const e = toAppError(err);
      log.error("person failed to load", { err, personId, code: e.code });
      return (
        <Container>
          <PageHeader eyebrow={`/directory/${personId}`} title="Colleague" />
          <ErrorState title="This colleague could not be loaded" code={e.code} reqId={currentReqId()} body={e.message} />
        </Container>
      );
    }
    if (!data) {
      log.branch("render 404", `no employee with id ${personId}`, { code: "NOT_FOUND" });
      notFound();
    }

    const { person: p } = data;
    const load = data.asks.length;
    const activeMentees = data.mentoring.filter((m) => !m.endedOn);
    // Started here, inside the request context, so its log lines keep this request id while the
    // section streams in behind its skeleton.
    const viewer = await getViewer();
    const profile = viewer.user ? await getProfile(viewer.user.id) : null;
    if (!profile) log.branch("availability advice as Slack", viewer.user ? `${viewer.user.id} has no onboarding profile` : "signed-out visitor, default channel");
    const availability = availabilityForPerson(`person ${p.id}`, p.id, viewer.personaId, profile?.preferredChannel ?? "slack", clock.now).catch((err: unknown) => {
      log.error(`availability for ${p.id} failed`, { err, code: "AVAILABILITY_FAILED" });
      return "failed" as const;
    });

    return (
      <Container>
        <PageHeader
          eyebrow={`/directory/${p.id}`}
          title={p.name}
          description={
            <>
              {p.title}, {p.team} ({p.department})
            </>
          }
          actions={<ButtonLink href="/directory">Back to directory</ButtonLink>}
        />
        <div className="flex flex-col-reverse gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div id="person" className="flex min-w-0 flex-col gap-10">
            <Section title="Summary">
              <p className="max-w-[70ch]">{p.bio}</p>
              <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted">Employee id</dt>
                <dd className="font-mono text-[13px]">{p.id}</dd>
                <dt className="text-muted">Email</dt>
                <dd className="font-mono text-[13px] break-all">{p.email}</dd>
                <dt className="text-muted">Slack</dt>
                <dd className="font-mono text-[13px]">{p.slackHandle}</dd>
                <dt className="text-muted">Timezone</dt>
                <dd>
                  <ZoneText tz={p.timezone} /> <span className="font-mono text-[12px] text-subtle">{p.timezone}</span>
                </dd>
                <dt className="text-muted">Started</dt>
                <dd>
                  <span className="font-mono text-[13px]">{formatDate(p.startDate)}</span> <span className="text-muted">({tenure(p.startDate, clock.now)})</span>
                </dd>
                <dt className="text-muted">Seniority</dt>
                <dd className="capitalize">{p.seniority}</dd>
                <dt className="text-muted">Manager</dt>
                <dd>
                  {data.manager ? (
                    <>
                      <Link href={`/directory/${data.manager.id}`}>{data.manager.name}</Link> <span className="text-muted">{data.manager.title}</span>
                    </>
                  ) : (
                    <span className="text-muted">None (top of the company)</span>
                  )}
                </dd>
                <dt className="text-muted">Reports</dt>
                <dd>
                  {data.reports.length ? (
                    <span>
                      {data.reports.map((r, i) => (
                        <span key={r.id}>
                          {i > 0 ? ", " : ""}
                          <Link href={`/directory/${r.id}`}>{r.name}</Link>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted">None</span>
                  )}
                </dd>
                <dt className="text-muted">Mentor</dt>
                <dd>{p.isMentor ? `Yes, ${activeMentees.length} active ${activeMentees.length === 1 ? "mentee" : "mentees"}` : "No"}</dd>
              </dl>
            </Section>

            <Section title="Services owned" meta="Ownership is the strongest signal when ranking who to ask.">
              {data.services.length ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Service</TH>
                      <TH>Role</TH>
                      <TH>Other owner</TH>
                      <TH>What it does</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.services.map((s) => (
                      <TR key={s.id}>
                        <TD>
                          <span className="font-mono text-[13px]">{s.name}</span>
                          <div className="font-mono text-[12px] text-subtle">{s.repo}</div>
                        </TD>
                        <TD>{s.role === "primary" ? <Badge tone="accent">Primary</Badge> : <Badge>Secondary</Badge>}</TD>
                        <TD className="whitespace-nowrap">{s.otherOwnerName ? <Link href={`/directory/${s.otherOwnerId}`}>{s.otherOwnerName}</Link> : s.otherOwnerId}</TD>
                        <TD className="min-w-[14rem]">{s.description}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EmptyState title="Owns no services" body="Not a primary or secondary owner of any service." />
              )}
            </Section>

            <Section title="Skills and evidence" meta="Each skill says where the belief comes from. Profile only means nothing in their work backs it up yet.">
              {data.skills.length ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Skill</TH>
                      <TH>Level</TH>
                      <TH>Source</TH>
                      <TH>Evidence</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.skills.map((s) => (
                      <TR key={s.skillId}>
                        <TD className="whitespace-nowrap font-medium">{s.name}</TD>
                        <TD mono className="whitespace-nowrap">
                          {s.proficiency} / 5
                        </TD>
                        <TD>
                          <SourceBadge source={s.source} />
                        </TD>
                        <TD className="min-w-[16rem]">{s.evidence}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EmptyState title="No skills recorded" />
              )}
            </Section>

            <Section title="Projects">
              {data.projects.length ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Project</TH>
                      <TH>Role</TH>
                      <TH>Status</TH>
                      <TH>Dates</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.projects.map((pr) => (
                      <TR key={pr.id}>
                        <TD className="min-w-[16rem]">
                          <span className="font-medium">{pr.name}</span>
                          {pr.serviceName ? <span className="ml-2 font-mono text-[12px] text-subtle">{pr.serviceName}</span> : null}
                          <div className="text-[13px] text-muted">{pr.description}</div>
                        </TD>
                        <TD className="capitalize">{pr.role}</TD>
                        <TD>{pr.status === "active" ? <Badge tone="success">Active</Badge> : <Badge>Finished</Badge>}</TD>
                        <TD mono className="whitespace-nowrap">
                          {formatDate(pr.startedOn)} to {pr.endedOn ? formatDate(pr.endedOn) : "now"}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EmptyState title="No projects yet" />
              )}
            </Section>

            <Section title="Mentorship" meta="Used for ranking (who has helped new hires before) and for fairness (who is already carrying mentees).">
              <h3 className="mb-2 text-[15px] font-semibold">Mentoring</h3>
              {data.mentoring.length ? (
                <MentorTable rows={data.mentoring} who="Mentee" />
              ) : (
                <p className="mb-4 text-sm text-muted">Has not mentored anyone.</p>
              )}
              <h3 className="mb-2 mt-6 text-[15px] font-semibold">Mentored by</h3>
              {data.mentoredBy.length ? <MentorTable rows={data.mentoredBy} who="Mentor" /> : <p className="text-sm text-muted">No mentor on record.</p>}
            </Section>

            <Section
              title="Ask load this week"
              meta={`Asks routed to this person in the last ${LOAD_WINDOW_DAYS} days, against a weekly limit of ${p.maxWeeklyAsks}. Load balancing routes around people over their limit.`}
            >
              <p className="mb-3 text-sm">
                <LoadCell load={load} max={p.maxWeeklyAsks} />
              </p>
              {data.asks.length ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Ask</TH>
                      <TH>From</TH>
                      <TH>Status</TH>
                      <TH>When</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.asks.map((a) => (
                      <TR key={a.id}>
                        <TD className="min-w-[14rem]">
                          {a.title}
                          <div className="font-mono text-[12px] text-subtle">{a.id}</div>
                        </TD>
                        <TD className="whitespace-nowrap">{a.askerId ? <Link href={`/directory/${a.askerId}`}>{a.askerName}</Link> : "Unknown"}</TD>
                        <TD className="capitalize">{a.status}</TD>
                        <TD mono className="whitespace-nowrap">
                          {a.createdAt.toISOString().slice(0, 10)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-muted">No asks in the last {LOAD_WINDOW_DAYS} days.</p>
              )}
            </Section>

            <Section
              title="Availability"
              meta={
                <>
                  Free and busy only, over the next 14 days, in their working hours. Times are in your time zone with theirs in parentheses.
                  {clock.pinned ? (
                    <>
                      {" "}
                      Demo clock: as of <span className="font-mono">{clockLabel(clock.now)}</span>, a fixed moment inside the seeded calendars.
                    </>
                  ) : null}
                </>
              }
            >
              <Suspense fallback={<PersonAvailabilitySkeleton />}>
                <PersonAvailabilityPanel promise={availability} personId={p.id} firstName={p.name.split(" ")[0]} />
              </Suspense>
            </Section>

            <Section title="Calendar, next 7 days">
              <WeekCalendar events={data.calendar} tz={p.timezone} now={clock.now} />
            </Section>

            <Section title="Documents written" meta="When a question is already answered in one of these, the app suggests the document before a person.">
              {data.docs.length ? (
                <ul className="flex flex-col border border-line">
                  {data.docs.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0">
                      <span>
                        {d.title}
                        <span className="ml-2 font-mono text-[12px] text-subtle">{d.id}</span>
                      </span>
                      <span className="text-[13px] text-muted">
                        {d.kind.replace("_", " ")}
                        {d.serviceName ? `, ${d.serviceName}` : ""}, updated <span className="font-mono">{formatDate(d.updatedOn)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Has not written any documents.</p>
              )}
            </Section>
          </div>
          <Toc rootId="person" className="border border-line bg-raised p-4 lg:border-0 lg:bg-transparent lg:p-0" />
        </div>
      </Container>
    );
  });
}

function MentorTable({ rows, who }: { rows: PersonDetail["mentoring"]; who: string }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>{who}</TH>
          <TH>Focus</TH>
          <TH>Status</TH>
          <TH>Dates</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((m) => (
          <TR key={m.id}>
            <TD className="whitespace-nowrap">
              <Link href={`/directory/${m.otherId}`}>{m.otherName}</Link>
              <div className="text-[12px] text-subtle">{m.otherTitle}</div>
            </TD>
            <TD className="min-w-[12rem]">{m.focus}</TD>
            <TD>{m.endedOn ? <Badge>Ended</Badge> : <Badge tone="success">Active</Badge>}</TD>
            <TD mono className="whitespace-nowrap">
              {formatDate(m.startedOn)} to {m.endedOn ? formatDate(m.endedOn) : "now"}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
