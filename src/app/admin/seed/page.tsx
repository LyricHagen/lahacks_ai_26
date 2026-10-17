import Link from "next/link";
import type { ReactNode } from "react";
import { Container, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { toAppError } from "@/lib/errors";
import { createLogger, currentReqId } from "@/lib/log";
import { withPage } from "@/lib/request-context";
import { getSeedStatus } from "@/lib/seed-status";
import { ReseedForm } from "./reseed-form";

export const metadata = { title: "Synthetic company" };

const log = createLogger("page.admin.seed");

const PLANTED_LABEL: Record<string, string> = {
  over: "Overloaded",
  decoy: "Decoy",
  vac: "On vacation",
  booked: "Fully booked",
  newhire: "Default persona",
};

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

export default async function SeedAdminPage() {
  return withPage("admin.seed", async () => {
    const header = (
      <PageHeader
        eyebrow="/admin/seed"
        title="Synthetic company"
        description="What is loaded, how big it is, and the planted cases the ranking must get right. Reseeding replaces the whole company."
      />
    );
    let s: Awaited<ReturnType<typeof getSeedStatus>>;
    try {
      s = await getSeedStatus();
    } catch (err) {
      const e = toAppError(err);
      log.error("seed status failed", { err, code: e.code });
      return (
        <Container>
          {header}
          <ErrorState title="Seed status could not be loaded" code={e.code} reqId={currentReqId()} body={e.message} />
        </Container>
      );
    }
    const person = (id: string) => {
      if (id === "doc") return <span className="text-muted">the document</span>;
      const p = s.people.get(id);
      return (
        <Link href={`/directory/${id}`} className="whitespace-nowrap">
          {p?.name ?? id}
        </Link>
      );
    };
    const templated = s.meta["seed.text_source"] === "template";
    log.info("rendering seed admin", { seed: s.seed, employees: s.counts.employees, templated });

    return (
      <Container>
        {header}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader title="Loaded now" meta={s.seed ? undefined : "Nothing is loaded yet."} />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
                <Row k="Seed string">
                  <span className="font-mono">{s.seed ?? "none"}</span>
                </Row>
                <Row k="Loaded from">{s.meta["seed.source"] === "fixture" ? "Committed fixture (fixtures/company.json)" : s.meta["seed.source"] === "generated" ? "Generated in memory" : "Not loaded"}</Row>
                <Row k="Text">
                  {templated ? (
                    <span>
                      <Badge tone="accent">Templated</Badge> <span className="text-muted">no model key when the fixture was made</span>
                    </span>
                  ) : s.meta["seed.text_source"] ? (
                    <span>
                      Written by <span className="font-mono">{s.meta["seed.text_model"]}</span>
                    </span>
                  ) : (
                    "unknown"
                  )}
                </Row>
                <Row k="Embeddings">
                  <span className="font-mono">{s.meta["seed.embedding_model"] ?? "none"}</span> <span className="text-muted">local, no API call</span>
                </Row>
                <Row k="Dates relative to">
                  <span className="font-mono">{s.meta["seed.anchor_day"] ?? "none"}</span>
                </Row>
                <Row k="Loaded at">
                  <span className="font-mono">{s.meta["seed.loaded_at"] ?? "never"}</span>
                </Row>
                <Row k="Last run took">
                  <span className="font-mono">{s.summary ? `${s.summary.totalMs}ms` : "n/a"}</span>
                </Row>
                <Row k="Committed fixture">
                  {s.fixture ? (
                    <span>
                      seed <span className="font-mono">{s.fixture.seed}</span>, generated <span className="font-mono">{s.fixture.generatedAt.slice(0, 10)}</span>, text{" "}
                      {s.fixture.text.source}
                    </span>
                  ) : (
                    <span>
                      <Badge tone="danger">Missing</Badge> run <span className="font-mono">pnpm fixture:generate</span>
                    </span>
                  )}
                </Row>
              </dl>
              {s.summary?.warnings.length ? (
                <ul className="mt-4 border-t border-line pt-3 text-[13px] text-muted">
                  {s.summary.warnings.map((w) => (
                    <li key={w}>
                      <span className="font-semibold text-fg">Warning:</span> {w}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Reseed" meta="Same seed, same company. Dates move with the load day." />
            <CardBody>
              <ReseedForm currentSeed={s.seed} defaultSeed={s.defaultSeed} fixtureSeed={s.fixture?.seed ?? null} />
            </CardBody>
          </Card>
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Row counts</h2>
          <Table>
            <THead>
              <TR>
                <TH>Table</TH>
                <TH className="text-right">Rows</TH>
                <TH>Last load</TH>
              </TR>
            </THead>
            <TBody>
              {Object.entries(s.counts).map(([table, n]) => {
                const st = s.summary?.steps.find((x) => x.step === `insert ${table}`);
                return (
                  <TR key={table}>
                    <TD mono>{table}</TD>
                    <TD mono className="text-right">
                      {n}
                    </TD>
                    <TD mono className="text-muted">
                      {st ? `${st.rows} rows in ${st.ms}ms` : table === "users" || table === "usage_log" ? "kept across reseeds" : ""}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </section>

        <section className="mt-10">
          <h2 className="mb-1 text-lg font-semibold tracking-tight">Planted scenarios</h2>
          <p className="mb-3 text-sm text-muted">Questions where the right answer is known in advance. The ranker (prompt 6) must pick the expected answer over the traps.</p>
          {s.scenarios.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Scenario</TH>
                  <TH>Question</TH>
                  <TH>Expected</TH>
                  <TH>Traps</TH>
                  <TH>Why</TH>
                </TR>
              </THead>
              <TBody>
                {s.scenarios.map((sc) => (
                  <TR key={sc.id}>
                    <TD>
                      <span className="font-mono text-[12px]">{sc.id}</span>
                      <div className="text-[12px] text-subtle">{sc.kind.replace(/_/g, " ")}</div>
                    </TD>
                    <TD className="min-w-[16rem]">{sc.question}</TD>
                    <TD>{sc.expectId === "doc" ? <span className="font-mono text-[12px]">{sc.docId}</span> : person(sc.expectId)}</TD>
                    <TD>
                      {sc.trapIds.length ? (
                        <span className="flex flex-col">
                          {sc.trapIds.map((id) => (
                            <span key={id}>{person(id)}</span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-subtle">none</span>
                      )}
                    </TD>
                    <TD className="min-w-[16rem] text-[13px] text-muted">{sc.why}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted">No scenarios recorded. Reseed to load them.</p>
          )}
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Planted people</h2>
          {s.planted.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Person</TH>
                  <TH>Role in the data</TH>
                  <TH>Slot</TH>
                </TR>
              </THead>
              <TBody>
                {s.planted.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      {person(p.id)}
                      <div className="text-[12px] text-subtle">{s.people.get(p.id)?.team}</div>
                    </TD>
                    <TD>{PLANTED_LABEL[p.planted.split("_")[0]] ?? p.planted}</TD>
                    <TD mono>{p.planted}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted">None loaded.</p>
          )}
        </section>

        <p className="mt-10 text-sm text-muted">
          The full seed summary is in the log under scope <span className="font-mono">seed.summary</span>: open the drawer (Ctrl+`) after a reseed, or run{" "}
          <span className="font-mono">pnpm seed</span> in a terminal.
        </p>
      </Container>
    );
  });
}
