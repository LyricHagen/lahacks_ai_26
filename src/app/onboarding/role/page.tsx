import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getPersonaSummary } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { getClock } from "@/lib/clock-request";
import { createLogger } from "@/lib/log";
import { getProfile, listPersonaOptions } from "@/lib/onboarding";
import { withPage } from "@/lib/request-context";
import { OnboardingFrame } from "../frame";
import { type PersonaOpt, RoleForm } from "../forms";

export const metadata = { title: "Your role" };

const log = createLogger("page.onboarding.role");

function daysAgo(iso: string, now: Date): number {
  return Math.round((now.getTime() - new Date(`${iso}T12:00:00Z`).getTime()) / 86400_000);
}

function tenure(iso: string, now: Date): string {
  const d = daysAgo(iso, now);
  if (d < 0) return `starts in ${-d} days`;
  if (d < 60) return `${d} days in`;
  if (d < 730) return `${Math.round(d / 30)} months in`;
  return `${Math.round(d / 365)} years in`;
}

export default async function Page() {
  return withPage("onboarding.role", async () => {
    const user = await requireUser("/onboarding/role");
    const [profile, persona, options, clock] = await Promise.all([getProfile(user.id), getPersonaSummary(user.employeeId), listPersonaOptions(user), getClock()]);
    const me = options.find((o) => o.current);
    log.info(`role step for ${user.id}, persona ${persona?.id ?? "none"}, ${options.length} options`, { userId: user.id });
    const opts: PersonaOpt[] = options.map((o) => ({ id: o.id, team: o.team, current: o.current, label: `${o.name}, ${o.title}, ${tenure(o.startDate, clock.now)}` }));
    return (
      <OnboardingFrame step="role" user={user} profile={profile} title="Is this you?" description="In this demo company you play one colleague. Confirm the one you were given, or pick another.">
        <Card className="mb-8">
          <CardHeader title={persona ? persona.name : "No persona assigned"} meta={persona ? `${persona.title}, ${persona.team}` : "Pick one below."} />
          {persona ? (
            <CardBody>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
                <dt className="text-muted">Team</dt>
                <dd>{persona.team}</dd>
                <dt className="text-muted">Title</dt>
                <dd>{persona.title}</dd>
                <dt className="text-muted">Manager</dt>
                <dd>{persona.managerId ? <Link href={`/directory/${persona.managerId}`}>{persona.managerName}</Link> : <span className="text-muted">none</span>}</dd>
                <dt className="text-muted">Start date</dt>
                <dd>
                  {me ? (
                    <>
                      <span className="font-mono">{me.startDate}</span> <span className="text-muted">({tenure(me.startDate, clock.now)})</span>
                    </>
                  ) : (
                    <span className="text-muted">see the directory</span>
                  )}
                </dd>
                <dt className="text-muted">Profile</dt>
                <dd>
                  <Link href={`/directory/${persona.id}`} className="font-mono text-[13px]">
                    {persona.id}
                  </Link>
                </dd>
              </dl>
            </CardBody>
          ) : null}
        </Card>
        <RoleForm personas={opts} currentId={user.employeeId} />
      </OnboardingFrame>
    );
  });
}
