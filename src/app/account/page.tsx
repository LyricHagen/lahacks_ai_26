import Link from "next/link";
import { Container, PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getPersonaSummary } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { budgetLimits } from "@/lib/budget";
import { MODE_REASON_LABEL, resolveMode } from "@/lib/mode";
import { getRequestedMode } from "@/lib/mode-request";
import { withPage } from "@/lib/request-context";
import { getPhoneView } from "@/lib/phone";
import { DeleteAccount, DemoToggle, LogoutButton } from "./account-controls";
import { PhoneCard } from "./phone-card";

export const metadata = { title: "Account" };

export default async function Page() {
  return withPage("account", async () => {
    const user = await requireUser("/account");
    const requested = await getRequestedMode();
    const [mode, persona, phone] = await Promise.all([resolveMode(user, requested), getPersonaSummary(user.employeeId), getPhoneView(user)]);
    const limits = budgetLimits();
    return (
      <Container className="max-w-3xl">
        <PageHeader eyebrow="/account" title="Account" actions={<LogoutButton />} />
        <div className="grid gap-6">
          <Card>
            <CardHeader title="You" />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
                <dt className="text-muted">Email</dt>
                <dd className="min-w-0 break-words font-mono">{user.email}</dd>
                <dt className="text-muted">Account id</dt>
                <dd className="font-mono">{user.id}</dd>
                <dt className="text-muted">Status</dt>
                <dd>
                  {user.status}
                  {user.status !== "approved" ? (
                    <span className="text-muted">
                      {" "}
                      (<Link href="/pending">what this means</Link>)
                    </span>
                  ) : null}
                </dd>
                <dt className="text-muted">Role</dt>
                <dd>{user.role}</dd>
                <dt className="text-muted">Persona</dt>
                <dd>
                  {persona ? (
                    <>
                      <Link href={`/directory/${persona.id}`}>{persona.name}</Link>, {persona.title}, {persona.team}
                      {persona.managerId ? (
                        <span className="text-muted">
                          , reports to <Link href={`/directory/${persona.managerId}`}>{persona.managerName}</Link>
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted">none assigned</span>
                  )}
                </dd>
              </dl>
            </CardBody>
          </Card>

          <Card id="mode">
            <CardHeader title={`Mode: ${mode.mode}`} meta={MODE_REASON_LABEL[mode.reason]} actions={user.status === "approved" ? <DemoToggle demoOn={requested === "demo"} /> : undefined} />
            <CardBody className="text-sm">
              <p>
                {mode.mode === "live"
                  ? "Results come from live model calls. Each call is metered against your daily budget."
                  : "Results come from the demo fixtures committed with the app. No model is called and nothing is spent."}
              </p>
              <p className="mt-2 text-muted">Why: {mode.message}.</p>
              <dl className="mt-4 grid gap-x-6 gap-y-1 font-mono text-[12px] sm:grid-cols-[14rem_1fr]">
                <dt className="text-muted">reason</dt>
                <dd>{mode.reason}</dd>
                <dt className="text-muted">your tokens today</dt>
                <dd>
                  {mode.budget?.userUsed ?? "n/a"} of {limits.userDailyTokens}
                </dd>
                <dt className="text-muted">shared tokens today</dt>
                <dd>
                  {mode.budget?.globalUsed ?? "n/a"} of {limits.globalDailyTokens}
                </dd>
              </dl>
            </CardBody>
          </Card>
          {phone.enabled && !user.isDemo ? (
            <Card id="phone">
              <CardHeader title="Text drafts to your phone" meta={phone.status === "linked" ? "linked" : phone.status === "pending" ? "waiting for your text" : "not linked"} />
              <CardBody>
                <PhoneCard view={phone} />
              </CardBody>
            </Card>
          ) : null}
          {user.isDemo ? null : (
            <Card>
              <CardHeader title="Delete your account" />
              <CardBody>
                <p className="mb-4 text-sm text-muted">
                  Removes your account and everything tied to it: profile, asks, drafts, ramp plans, dismissals, usage records and a linked phone number. See the <a href="/privacy#deleting-your-account">privacy policy</a>.
                </p>
                <DeleteAccount />
              </CardBody>
            </Card>
          )}
        </div>
      </Container>
    );
  });
}
