import Link from "next/link";
import { Container, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { budgetLimits } from "@/lib/budget";
import { toAppError } from "@/lib/errors";
import { createLogger, currentReqId } from "@/lib/log";
import { hasProviderKey } from "@/lib/mode";
import { withPage } from "@/lib/request-context";
import { getUsageReport, type SpendRow, type SpendTotals } from "@/lib/usage";
import { GateCheck } from "./gate-check";

export const metadata = { title: "Model usage" };

const log = createLogger("page.admin.usage");

const usd = (n: number | null) => (n === null ? "n/a" : n.toFixed(4));

function Totals({ title, t }: { title: string; t: SpendTotals }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Calls</dt>
          <dd className="font-mono text-right">{t.calls}</dd>
          <dt className="text-muted">Live</dt>
          <dd className="font-mono text-right">{t.live}</dd>
          <dt className="text-muted">Cached fallbacks</dt>
          <dd className="font-mono text-right">{t.fallbacks}</dd>
          <dt className="text-muted">Tokens</dt>
          <dd className="font-mono text-right">{t.tokens}</dd>
          <dt className="text-muted">Cost USD</dt>
          <dd className="font-mono text-right">{usd(t.costUsd)}</dd>
        </dl>
      </CardBody>
    </Card>
  );
}

function SpendTable({ rows, first, link }: { rows: SpendRow[]; first: string; link?: boolean }) {
  if (!rows.length) return <EmptyState title="No model calls yet" />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>{first}</TH>
          <TH className="text-right">Calls</TH>
          <TH className="text-right">Fallbacks</TH>
          <TH className="text-right">Tokens today</TH>
          <TH className="text-right">USD today</TH>
          <TH className="text-right">Tokens all time</TH>
          <TH className="text-right">USD all time</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.key}>
            <TD className="min-w-[10rem]">
              {link && r.label ? <div className="break-all">{r.label}</div> : null}
              <div className={link && r.label ? "font-mono text-[12px] text-subtle" : "font-mono text-[13px]"}>{r.key === "none" ? "no account (script or signed out)" : r.key}</div>
            </TD>
            <TD mono className="text-right">
              {r.calls}
            </TD>
            <TD mono className="text-right">
              {r.fallbacks}
            </TD>
            <TD mono className="text-right">
              {r.todayTokens}
            </TD>
            <TD mono className="text-right">
              {usd(r.todayCostUsd)}
            </TD>
            <TD mono className="text-right">
              {r.tokens}
            </TD>
            <TD mono className="text-right">
              {usd(r.costUsd)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export default async function Page() {
  return withPage("admin.usage", async () => {
    await requireAdmin("view /admin/usage");
    const limits = budgetLimits();
    const header = (
      <PageHeader
        eyebrow="/admin/usage"
        title="Model usage"
        description="Every call through callModel writes one usage_log row, live or not. Cached fallbacks cost nothing. Days are UTC."
      />
    );
    let r: Awaited<ReturnType<typeof getUsageReport>>;
    try {
      r = await getUsageReport();
    } catch (err) {
      const e = toAppError(err);
      log.error("usage report failed", { err, code: e.code });
      return (
        <Container>
          {header}
          <ErrorState title="Usage could not be loaded" code={e.code} reqId={currentReqId()} body={e.message} />
        </Container>
      );
    }
    return (
      <Container>
        {header}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr]">
          <Totals title="Today" t={r.today} />
          <Totals title="All time" t={r.allTime} />
          <Card>
            <CardHeader title="Gate" meta={hasProviderKey() ? "ANTHROPIC_API_KEY is set" : "ANTHROPIC_API_KEY is not set: every call falls back"} />
            <CardBody>
              <dl className="mb-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 font-mono text-[12px]">
                <dt className="text-muted">USER_DAILY_TOKEN_BUDGET</dt>
                <dd className="text-right">{limits.userDailyTokens}</dd>
                <dt className="text-muted">GLOBAL_DAILY_TOKEN_BUDGET</dt>
                <dd className="text-right">{limits.globalDailyTokens}</dd>
                <dt className="text-muted">shared tokens today</dt>
                <dd className="text-right">{r.today.tokens}</dd>
              </dl>
              <GateCheck />
            </CardBody>
          </Card>
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">By user</h2>
          <SpendTable rows={r.byUser} first="Account" link />
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">By purpose</h2>
          <SpendTable rows={r.byPurpose} first="Purpose" />
        </section>

        <section className="mt-10">
          <h2 className="mb-1 text-lg font-semibold tracking-tight">Recent calls</h2>
          <p className="mb-3 text-sm text-muted">
            The 50 most recent. Filter <Link href="/debug?view=server">the server log</Link> by a request id to see the gate checks for that call.
          </p>
          {r.recent.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Time (UTC)</TH>
                  <TH>Account</TH>
                  <TH>Purpose</TH>
                  <TH>Outcome</TH>
                  <TH className="text-right">Tokens in/out</TH>
                  <TH className="text-right">Latency</TH>
                  <TH className="text-right">USD</TH>
                  <TH>Request</TH>
                </TR>
              </THead>
              <TBody>
                {r.recent.map((c) => (
                  <TR key={c.id}>
                    <TD mono className="whitespace-nowrap">
                      {c.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                    </TD>
                    <TD className="min-w-[10rem]">
                      {c.userId ? (
                        <>
                          <div className="break-all">{c.email ?? c.userId}</div>
                          <div className="font-mono text-[12px] text-subtle">{c.userId}</div>
                        </>
                      ) : (
                        <span className="text-subtle">none</span>
                      )}
                    </TD>
                    <TD>
                      <span className="font-mono text-[13px]">{c.purpose}</span>
                      <div className="font-mono text-[12px] text-subtle">{c.model}</div>
                    </TD>
                    <TD>
                      <Badge tone={c.outcome === "live" ? "success" : c.outcome === "provider_error" ? "danger" : "neutral"}>{c.outcome === "live" ? "live" : `cached: ${c.outcome}`}</Badge>
                      {c.errorCode ? <div className="mt-1 font-mono text-[12px] text-danger">{c.errorCode}</div> : null}
                    </TD>
                    <TD mono className="text-right whitespace-nowrap">
                      {c.inputTokens}/{c.outputTokens}
                    </TD>
                    <TD mono className="text-right">
                      {c.latencyMs}ms
                    </TD>
                    <TD mono className="text-right">
                      {usd(c.costUsd)}
                    </TD>
                    <TD mono className="text-[12px]">
                      {c.reqId ?? ""}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No model calls yet" body="Run a gate check above to write the first row." />
          )}
        </section>
      </Container>
    );
  });
}
