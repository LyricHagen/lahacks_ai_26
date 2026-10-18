import Link from "next/link";
import { Container, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { toAppError } from "@/lib/errors";
import { createLogger, currentReqId } from "@/lib/log";
import { type EvalFile, getTierReport, readEvalResults, type TierStat } from "@/lib/model-tiers";
import { withPage } from "@/lib/request-context";

export const metadata = { title: "Models" };

const log = createLogger("page.admin.models");

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)}s` : `${Math.round(x)}ms`);
const usd = (x: number) => (x === 0 ? "$0" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);

const CATEGORY_LABEL: Record<string, string> = {
  clear: "Clear",
  vague: "Vague",
  no_vocab: "No vocabulary",
  two_problems: "Two problems",
  sensitive: "Sensitive",
  second_language: "Second language",
};

function EvalTable({ r }: { r: EvalFile }) {
  const best = (pick: (s: EvalFile["systems"][number]) => number, low = false) => {
    const xs = r.systems.map(pick);
    return low ? Math.min(...xs.filter((x) => x > 0)) : Math.max(...xs);
  };
  const bestF1 = best((s) => s.test.entityF1);
  const bestP50 = best((s) => (s.system === "keywords" ? Infinity : s.test.p50), true);
  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>System</TH>
            <TH className="text-right">Schema valid</TH>
            <TH className="text-right">Entity F1</TH>
            <TH className="text-right">Sensitive recall</TH>
            <TH className="text-right">Help kind</TH>
            <TH className="text-right">Urgency</TH>
            <TH className="text-right">p50</TH>
            <TH className="text-right">p95</TH>
            <TH className="text-right">Per 1k calls</TH>
            <TH className="text-right">Held-out services F1</TH>
          </TR>
        </THead>
        <TBody>
          {r.systems.map((s) => (
            <TR key={s.system}>
              <TD className="min-w-[13rem]">
                {s.label}
                <div className="font-mono text-[12px] text-subtle">{s.model}</div>
              </TD>
              <TD mono className="text-right">
                {pct(s.test.validity)}
              </TD>
              <TD mono className={s.test.entityF1 === bestF1 ? "text-right font-semibold" : "text-right"}>
                {pct(s.test.entityF1)}
              </TD>
              <TD mono className="text-right">
                {pct(s.test.sensitiveRecall)}
              </TD>
              <TD mono className="text-right">
                {pct(s.test.helpKindAcc)}
              </TD>
              <TD mono className="text-right">
                {pct(s.test.urgencyAcc)}
              </TD>
              <TD mono className={s.test.p50 === bestP50 ? "text-right font-semibold" : "text-right"}>
                {ms(s.test.p50)}
              </TD>
              <TD mono className="text-right">
                {ms(s.test.p95)}
              </TD>
              <TD mono className="text-right">
                {usd(s.test.costPer1k)}
              </TD>
              <TD mono className="text-right">
                {s.heldout ? pct(s.heldout.entityF1) : "n/a"}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <h3 className="mb-2 mt-8 text-[15px] font-semibold">Entity F1 by category</h3>
      <Table>
        <THead>
          <TR>
            <TH>System</TH>
            {Object.keys(CATEGORY_LABEL).map((c) => (
              <TH key={c} className="text-right">
                {CATEGORY_LABEL[c]}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {r.systems.map((s) => (
            <TR key={s.system}>
              <TD className="min-w-[13rem]">{s.label}</TD>
              {Object.keys(CATEGORY_LABEL).map((c) => (
                <TD key={c} mono className="text-right">
                  {s.byCategory[c] ? pct(s.byCategory[c].entityF1) : "n/a"}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
      <ul className="mt-4 grid gap-1 text-[13px] text-muted">
        {r.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}

export default async function Page() {
  return withPage("admin.models", async () => {
    // Open to anyone on the development server (read only, for recording the demo); production keeps the admin check.
    if (process.env.NODE_ENV === "development") log.branch("skip the admin check", "development server: /admin/models is open locally");
    else await requireAdmin("view /admin/models");
    const header = (
      <PageHeader
        eyebrow="/admin/models"
        title="Models"
        description="The understand_ask fine-tune against the frontier, and which tier served each live call. Tiers: the fine-tuned model on Veri first, then Claude Haiku 5.5, then the deterministic reader."
      />
    );
    let evalResults: EvalFile | null;
    let tiers: Awaited<ReturnType<typeof getTierReport>>;
    try {
      [evalResults, tiers] = await Promise.all([readEvalResults(), getTierReport()]);
    } catch (err) {
      const e = toAppError(err);
      log.error("models page failed", { err, code: e.code });
      return (
        <Container>
          {header}
          <ErrorState title="Model report could not be loaded" code={e.code} reqId={currentReqId()} body={e.message} />
        </Container>
      );
    }
    const appStats = tiers.stats.filter((r) => r.origin === "app");
    const scriptStats = tiers.stats.filter((r) => r.origin === "script");
    return (
      <Container>
        {header}
        <Card className="mb-10">
          <CardHeader title="Fine-tune tier" meta={tiers.veri.unavailable ? `off: ${tiers.veri.unavailable}` : "on"} />
          <CardBody>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-[12px]">
              <dt className="text-muted">VERI_UNDERSTAND_DEPLOYMENT</dt>
              <dd className="break-all">{tiers.veri.deployment ?? "not set"}</dd>
              <dt className="text-muted">adapter alias</dt>
              <dd>{tiers.veri.model}</dd>
              <dt className="text-muted">timeout before the frontier tier</dt>
              <dd>{tiers.veri.timeoutMs}ms</dd>
            </dl>
          </CardBody>
        </Card>

        <section aria-labelledby="eval-h">
          <h2 id="eval-h" className="mb-1 text-lg font-semibold tracking-tight">
            Eval: understand_ask on held-out asks
          </h2>
          <p className="mb-3 text-sm text-muted">
            {evalResults ? (
              <>
                {evalResults.testN} test asks (50 per category) and {evalResults.heldoutN} about services never seen in training. Generated <span className="font-mono">{evalResults.generatedAt.slice(0, 16).replace("T", " ")}</span> UTC by <span className="font-mono">pnpm train:eval</span>, prompt <span className="font-mono">{evalResults.promptVersion}</span>. The committed copy is <span className="font-mono">scripts/train/EVAL.md</span>.
              </>
            ) : null}
          </p>
          {evalResults ? <EvalTable r={evalResults} /> : <EmptyState title="No eval results yet" body="Run pnpm train:eval to write data/understand/eval/results.json, then reload." />}
        </section>

        <section aria-labelledby="live-h" className="mt-12">
          <h2 id="live-h" className="mb-1 text-lg font-semibold tracking-tight">
            Live calls by tier, last {tiers.days} days
          </h2>
          <p className="mb-3 text-sm text-muted">
            From usage_log. Demo results are listed as recorded or deterministic. Per-call detail is on <Link href="/admin/usage">Model usage</Link>.
          </p>
          {appStats.length ? (
            <TierTable rows={appStats} />
          ) : (
            <EmptyState title="No model calls in this window" body="Submit an ask on /ask/new; every call writes a usage_log row with its tier." />
          )}
          {scriptStats.length ? (
            <>
              <h3 className="mt-8 mb-1 text-base font-semibold">Owner scripts</h3>
              <p className="mb-3 text-sm text-muted">The eval, fixtures:record and train:generate, run from the command line with the tier forced. Not product traffic, and not counted in the daily budgets.</p>
              <TierTable rows={scriptStats} />
            </>
          ) : null}
        </section>

        <section aria-labelledby="fail-h" className="mt-12">
          <h2 id="fail-h" className="mb-1 text-lg font-semibold tracking-tight">
            Recent tier fallbacks
          </h2>
          <p className="mb-3 text-sm text-muted">Calls where an earlier tier failed or timed out before another answered.</p>
          {tiers.failures.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Time (UTC)</TH>
                  <TH>Served by</TH>
                  <TH>Why</TH>
                  <TH>Request</TH>
                </TR>
              </THead>
              <TBody>
                {tiers.failures.map((f) => (
                  <TR key={`${f.at.toISOString()}-${f.reqId}`}>
                    <TD mono className="whitespace-nowrap">
                      {f.at.toISOString().replace("T", " ").slice(0, 19)}
                    </TD>
                    <TD mono>{f.tier}</TD>
                    <TD className="min-w-[16rem] text-[13px]">{f.note}</TD>
                    <TD mono className="text-[12px]">
                      {f.reqId ?? ""}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No fallbacks in this window" />
          )}
        </section>
      </Container>
    );
  });
}

function TierTable({ rows }: { rows: TierStat[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Purpose</TH>
          <TH>Tier</TH>
          <TH className="text-right">Calls</TH>
          <TH className="text-right">p50</TH>
          <TH className="text-right">p95</TH>
          <TH className="text-right">Avg cost</TH>
          <TH className="text-right">Total</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((s) => (
          <TR key={`${s.origin}-${s.purpose}-${s.tier}-${s.model}`}>
            <TD mono className="text-[13px]">
              {s.purpose}
            </TD>
            <TD>
              <Badge tone={s.tier === "finetune" ? "accent" : s.provider === "fixture" ? "neutral" : "success"}>{s.tier}</Badge>
              <div className="mt-1 font-mono text-[12px] text-subtle">
                {s.provider}:{s.model}
              </div>
            </TD>
            <TD mono className="text-right">
              {s.calls}
            </TD>
            <TD mono className="text-right">
              {ms(s.p50)}
            </TD>
            <TD mono className="text-right">
              {ms(s.p95)}
            </TD>
            <TD mono className="text-right">
              {usd(s.avgCostUsd)}
            </TD>
            <TD mono className="text-right">
              {usd(s.costUsd)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
