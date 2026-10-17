import Link from "next/link";
import { Container } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";

const log = createLogger("page.landing");

const STEPS = [
  {
    title: "Describe the problem",
    body: "Write it the way you would say it to a teammate. No need to know the team name, the system name, or the right jargon.",
  },
  {
    title: "Get a short list of people",
    body: "Who2Ask reads the company directory, ownership records and past questions, then ranks the colleagues most likely to help.",
  },
  {
    title: "See why each person is on it",
    body: "Every name comes with the evidence behind it: what they own, what they have answered before, and how close they are to your team.",
  },
  {
    title: "Check when they are free",
    body: "Their calendar is read for open time in the next few days, so you can ask when they can actually answer.",
  },
  {
    title: "Send it yourself",
    body: "Who2Ask drafts a short, specific message. You edit it, copy it, and send it from your own account. It never sends anything for you.",
  },
];

const SIGNALS: Array<[string, string]> = [
  ["Ownership", "They are listed as owner or on call for the system, service or process your problem touches."],
  ["Demonstrated knowledge", "They have answered similar questions, written the relevant docs, or made recent changes in that area."],
  ["Distance", "People on or near your team come first, because asking them costs less social capital."],
  ["Availability", "Someone free this afternoon beats someone out for two weeks, even if the second knows slightly more."],
  ["Load", "People who already field many new hire questions are ranked down a little, so the same few experts do not burn out."],
];

const WONT = [
  "Send a message, book a meeting, or contact anyone on your behalf.",
  "Rank anyone by performance, seniority as status, or anything other than likelihood of helping with this problem.",
  "Show a manager what an individual new hire asked. Manager views are aggregated and anonymized.",
  "Read message contents or private calendar event details. It sees only free and busy blocks.",
  "Pretend to be certain. When the evidence is thin it says so, and suggests asking your manager or onboarding buddy instead.",
];

export default async function LandingPage() {
  return withPage("landing", async () => {
    log.info("rendering landing page", { steps: STEPS.length, signals: SIGNALS.length });
    return (
      <>
        <section className="border-b border-line">
          <Container className="grid gap-10 py-16 lg:grid-cols-[1.1fr_1fr] lg:items-start">
            <div>
              <p className="font-mono text-[12px] text-subtle mb-4">for people in their first months at a company</p>
              <h1 className="text-[2.25rem] leading-[1.15] font-semibold tracking-tight max-w-[18ch]">Know who to ask, and how to ask them.</h1>
              <p className="mt-5 text-lg text-muted max-w-[52ch]">
                Describe a problem in plain words. Who2Ask finds the colleague most likely to help, tells you why, checks when they are free,
                and drafts the message. You always send it yourself.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/demo" variant="primary">
                  Try the guided demo
                </ButtonLink>
                <ButtonLink href="/signup">Create an account</ButtonLink>
              </div>
              <p className="mt-6 text-[13px] text-subtle">The company in this app is synthetic. No real employee data is used.</p>
            </div>

            <figure className="border border-line bg-raised">
              <figcaption className="flex items-center justify-between border-b border-line px-4 py-2 text-[13px]">
                <span className="font-medium">Example ask</span>
                <span className="font-mono text-[12px] text-subtle">synthetic data</span>
              </figcaption>
              <div className="px-4 py-4 border-b border-line bg-sunken">
                <p className="text-sm">
                  &ldquo;I need read access to the billing data warehouse for a dashboard. Nobody on my team knows who approves it.&rdquo;
                </p>
              </div>
              <ol className="divide-y divide-line">
                <li className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold">
                      <span className="font-mono text-[12px] text-subtle mr-2">1</span>Priya Raman
                    </p>
                    <Badge tone="success">Free Tue 14:00</Badge>
                  </div>
                  <p className="text-[13px] text-muted mt-1">Data Platform. Owns warehouse access requests; approved 31 similar requests this quarter.</p>
                </li>
                <li className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold">
                      <span className="font-mono text-[12px] text-subtle mr-2">2</span>Marcus Oyelaran
                    </p>
                    <Badge tone="danger">Busy until Thu</Badge>
                  </div>
                  <p className="text-[13px] text-muted mt-1">Billing Engineering. Wrote the billing schema docs; two teams away from yours.</p>
                </li>
              </ol>
            </figure>
          </Container>
        </section>

        <Container className="grid gap-16 py-16">
          <section aria-labelledby="how" className="grid gap-8 lg:grid-cols-[16rem_1fr]">
            <div>
              <h2 id="how" className="text-xl font-semibold">
                What it does
              </h2>
              <p className="mt-2 text-sm text-muted">Five steps, and the last one is always yours.</p>
            </div>
            <ol className="border-t border-line">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[2.5rem_1fr] gap-2 border-b border-line py-5">
                  <span className="font-mono text-sm text-subtle">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="mt-1 text-muted max-w-[60ch]">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="ranking" className="grid gap-8 lg:grid-cols-[16rem_1fr]">
            <div>
              <h2 id="ranking" className="text-xl font-semibold">
                How it ranks
              </h2>
              <p className="mt-2 text-sm text-muted">
                Each candidate is scored on these signals. The explanation you see quotes the evidence for each one, so you can disagree with it.
              </p>
            </div>
            <dl className="border border-line">
              {SIGNALS.map(([name, desc]) => (
                <div key={name} className="grid gap-1 border-b border-line px-4 py-4 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
                  <dt className="font-semibold">{name}</dt>
                  <dd className="text-muted">{desc}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="wont" className="grid gap-8 lg:grid-cols-[16rem_1fr]">
            <div>
              <h2 id="wont" className="text-xl font-semibold">
                What it will not do
              </h2>
              <p className="mt-2 text-sm text-muted">These are rules in the code, not settings.</p>
            </div>
            <ul className="border-t border-line">
              {WONT.map((w) => (
                <li key={w} className="border-b border-line py-3 pl-4 relative">
                  <span aria-hidden="true" className="absolute left-0 top-[1.35rem] h-px w-2 bg-fg" />
                  {w}
                </li>
              ))}
            </ul>
          </section>

          <section className="border-t border-line pt-8 flex flex-wrap items-center justify-between gap-4">
            <p className="text-muted max-w-[60ch]">
              Read the <Link href="/privacy">privacy policy</Link> for exactly what is stored, and the <Link href="/terms">terms</Link> for how
              this prototype may be used.
            </p>
            <ButtonLink href="/ask/new" variant="primary">
              Start an ask
            </ButtonLink>
          </section>
        </Container>
      </>
    );
  });
}
