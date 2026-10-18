import Link from "next/link";
import { EnterDemoButton } from "@/components/demo/demo-controls";
import { Container, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { getSessionUser } from "@/lib/auth";
import { clockLabel } from "@/lib/clock";
import { ensureDemoState } from "@/lib/demo";
import { DEMO_STEPS, demoStepHref } from "@/lib/demo-script";
import { type GuidedView, getGuidedView } from "@/lib/demo-view";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Guided demo" };

const log = createLogger("page.demo");

export default async function Page() {
  return withPage("demo.index", async () => {
    const [viewer, user] = await Promise.all([getViewer(), getSessionUser()]);
    let v: GuidedView;
    try {
      const state = await ensureDemoState("viewing /demo");
      v = await getGuidedView(state, viewer);
    } catch (err) {
      if (err instanceof AppError && (err.code === "DEMO_NOT_READY" || err.code === "DEMO_RESET_BUSY")) {
        log.branch("render demo error state", `${err.code}: ${err.message}`);
        return (
          <Container className="max-w-4xl">
            <PageHeader eyebrow="/demo" title="Guided demo" />
            <ErrorState title={err.code === "DEMO_RESET_BUSY" ? "The demo is being reset" : "The demo is not ready"} code={err.code} body={err.message} />
          </Container>
        );
      }
      throw err;
    }
    const inDemo = !!user?.isDemo;
    const p = v.persona;
    log.info(`demo overview for ${viewer.actorId}${inDemo ? " (demo account)" : ""}: guided ${v.askId} in ${v.status}`);
    return (
      <Container className="max-w-4xl">
        <PageHeader
          eyebrow="/demo"
          title="Guided demo"
          description="Who2Ask finds the right colleague to ask and drafts the message. See it in four short steps, using one new hire's real problem."
        />
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_18rem]">
          <section aria-labelledby="steps-h">
            <h2 id="steps-h" className="mb-3 text-[15px] font-semibold">
              How it works
            </h2>
            <ol className="divide-y divide-line border border-line">
              {DEMO_STEPS.map((s, i) => (
                <li key={s.slug} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 px-4 py-3">
                  <span className="font-mono text-[15px] font-semibold text-muted">{i + 1}</span>
                  <div>
                    <Link href={demoStepHref(s.slug)} className="font-semibold">
                      {s.title}
                    </Link>
                    <p className="text-[13px] text-muted">{s.line}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <aside className="grid content-start gap-4">
            <Card>
              <CardHeader title="You play" />
              <CardBody className="grid gap-1 text-sm">
                {p ? (
                  <>
                    <Link href={`/directory/${p.id}`} className="font-semibold">
                      {p.name}
                    </Link>
                    <p>
                      {p.title}, {p.team}
                    </p>
                    <p className="text-muted">{p.daysIn ?? "A few"} days into the job{p.managerName ? `, reports to ${p.managerName}` : ""}</p>
                    <p className="font-mono text-[12px] text-muted">{p.id}</p>
                  </>
                ) : (
                  <p className="text-muted">The demo persona is missing.</p>
                )}
              </CardBody>
            </Card>
            {inDemo ? (
              <ButtonLink href={demoStepHref("ask")} variant="primary">
                Start
              </ButtonLink>
            ) : (
              <EnterDemoButton />
            )}
            <p className="text-[13px] text-muted">
              {inDemo ? "You are in the demo account." : "Starting signs you in to a shared demo account."} Reset demo, at the top of every page, puts everything back. Clock fixed at{" "}
              <span className="font-mono">{clockLabel(v.clock.now)}</span>.
            </p>
          </aside>
        </div>
      </Container>
    );
  });
}
