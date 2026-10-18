import Link from "next/link";
import { Container, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { getPersonaSummary } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { createLogger } from "@/lib/log";
import { needsOnboarding } from "@/lib/onboarding";
import { withPage } from "@/lib/request-context";

export const metadata = { title: "Waiting for approval" };

const log = createLogger("page.pending");

export default async function Page() {
  return withPage("pending", async () => {
    const user = await requireUser("/pending");

    if (user.status === "rejected") {
      log.branch("show the plain not-approved message", `${user.id} is rejected`);
      return (
        <Container className="max-w-xl">
          <PageHeader eyebrow="/pending" title="Account not approved" />
          <p>This account was not approved for live model access.</p>
          <p className="mt-4">
            <Link href="/demo">Continue in demo mode</Link>
          </p>
        </Container>
      );
    }

    const [persona, onboard] = await Promise.all([getPersonaSummary(user.employeeId), needsOnboarding(user.id)]);
    const approved = user.status === "approved";
    log.branch(approved ? "show approved state" : "show pending state", `${user.id} status ${user.status}`);

    return (
      <Container className="max-w-xl">
        <PageHeader eyebrow="/pending" title={approved ? "Account approved" : "Waiting for approval"} />
        {approved ? (
          <p>Your account is approved. Model calls run live, within a daily token budget.</p>
        ) : (
          <>
            <p>
              Live model access needs manual approval, because every model call costs real money. An admin approves accounts by hand. Until then, everything in the app works in
              demo mode, using results computed ahead of time.
            </p>
            <p className="mt-3 text-muted">Nothing else is needed from you. Log in again later, or keep browsing in demo mode.</p>
          </>
        )}

        <dl className="mt-8 grid gap-x-6 gap-y-2 border-t border-line pt-5 text-sm sm:grid-cols-[9rem_1fr]">
          <dt className="text-muted">Email</dt>
          <dd className="min-w-0 break-words font-mono">{user.email}</dd>
          <dt className="text-muted">Signed up</dt>
          <dd className="font-mono">{user.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC</dd>
          <dt className="text-muted">Status</dt>
          <dd>{user.status}</dd>
          <dt className="text-muted">Your persona</dt>
          <dd>
            {persona ? (
              <>
                <Link href={`/directory/${persona.id}`}>{persona.name}</Link>, {persona.title}, {persona.team}
                {persona.managerName ? <span className="text-muted">, reports to {persona.managerName}</span> : null}
              </>
            ) : (
              <span className="text-muted">none assigned</span>
            )}
          </dd>
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          {onboard ? (
            <ButtonLink href="/onboarding" variant="primary">
              Set up your profile
            </ButtonLink>
          ) : null}
          {approved ? (
            <ButtonLink href="/dashboard" variant={onboard ? "secondary" : "primary"}>
              Go to the dashboard
            </ButtonLink>
          ) : (
            <ButtonLink href="/ask/new" variant={onboard ? "secondary" : "primary"}>
              Try an ask in demo mode
            </ButtonLink>
          )}
          <ButtonLink href="/account">Account</ButtonLink>
        </div>
      </Container>
    );
  });
}
