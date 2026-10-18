"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { chooseCandidate } from "@/app/ask/actions";
import { RecommendationBox } from "@/components/availability/recommendation";
import { StripLegend } from "@/components/availability/week-strip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import type { RankedPerson, RankingView } from "@/lib/ask-review";
import { clockLabel } from "@/lib/clock";
import { createLogger } from "@/lib/client-log";
import { COMPONENT_LABEL, COMPONENTS, firstName, GUARDRAIL_LABEL, type Ranked, rankCandidates, type Scored, templateReason, TUNE_STOPS } from "@/lib/rank";
import { PATH_LABEL } from "@/lib/retrieval-paths";

const log = createLogger("ask.shortlist");

const REASON_SOURCE_LINE = {
  model: "Reason written by the model from the evidence and breakdown above, and checked against them.",
  demo: "Cached demo reason, built from the evidence above and checked the same way as a live one.",
  template: "Reason built from the two components that added the most points.",
} as const;

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function Breakdown({ s, person, weights }: { s: Scored; person: RankedPerson | undefined; weights: Record<string, number> }) {
  return (
    <div className="grid gap-4 border-t border-line bg-sunken px-4 py-4">
      <Table>
        <THead>
          <TR>
            <TH>Component</TH>
            <TH className="text-right">Raw</TH>
            <TH className="text-right">Weight</TH>
            <TH className="text-right">Points</TH>
            <TH>From</TH>
          </TR>
        </THead>
        <TBody>
          {COMPONENTS.map((c) => {
            const v = s.contributions[c];
            return (
              <TR key={c}>
                <TD>{COMPONENT_LABEL[c]}</TD>
                <TD mono className="text-right">
                  {s.raw[c].toFixed(2)}
                </TD>
                <TD mono className="text-right">
                  {c === "loadPenalty" ? "-" : ""}
                  {fmt(weights[c])}
                </TD>
                <TD mono className={`text-right ${v < 0 ? "font-semibold text-danger" : ""}`}>
                  {v > 0 ? "+" : ""}
                  {fmt(v)}
                </TD>
                <TD className="text-[13px]">{s.detail[c]}</TD>
              </TR>
            );
          })}
          <TR>
            <TD className="font-semibold">Score</TD>
            <TD />
            <TD />
            <TD mono className="text-right font-semibold">
              {fmt(s.score)}
            </TD>
            <TD className="text-[13px] text-muted">Sum of points, kept between 0 and 100. Relevance (expertise only): {s.relevance.toFixed(2)}</TD>
          </TR>
        </TBody>
      </Table>
      {person?.evidence.length ? (
        <div className="grid gap-2">
          <p className="text-[13px] font-medium">Evidence from the search</p>
          <ul className="grid gap-2 text-[13px]">
            {person.evidence.map((e, i) => (
              <li key={i} className="grid gap-0.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
                <span>{e.detail}</span>
                <Link href={`/directory/${s.employeeId}`} className="font-mono text-[11px] text-subtle">
                  {PATH_LABEL[e.path]}: {e.source}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The next window in the asker's zone (theirs in parentheses), or why there is none. */
function nextWindowText(s: Scored): string {
  const a = s.availability;
  if (a.window) return `${a.window.label}${a.window.soft ? ", in focus time" : ""}${a.window.outsideAskerHours ? ", outside your working hours" : ""}`;
  if (a.window === null) return a.status === "ooo" ? "out of office for the next 14 days" : "nothing open in the next 14 days";
  // Ranked before prompt 7: only the horizon label was stored.
  return a.nextFreeLabel ?? (a.status === "booked" ? `not free in ${a.horizonLabel}` : "unknown");
}

function Row({
  s,
  person,
  weights,
  canChoose,
  busy,
  onChoose,
  strip,
  defaultOpen = false,
}: {
  s: Ranked;
  person: RankedPerson | undefined;
  weights: Record<string, number>;
  canChoose: boolean;
  busy: boolean;
  onChoose: (s: Ranked) => void;
  strip: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const serverReason = person?.reason ?? null;
  const reason = serverReason ?? templateReason(s);
  const source = serverReason ? (person?.reasonSource ?? "template") : "template";
  return (
    <li className="border border-line bg-raised" data-candidate={s.employeeId} data-rank={s.rank}>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
        <span className="font-mono text-[15px] font-semibold text-muted">{s.rank}</span>
        <div className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link href={`/directory/${s.employeeId}`} className="font-semibold">
              {s.name}
            </Link>
            <span className="text-sm text-muted">
              {s.title}, {s.team}
            </span>
            <span className="font-mono text-[12px] text-muted">{s.employeeId}</span>
            {person?.chosen ? <Badge tone="success">Chosen</Badge> : null}
            {s.flags.map((f) => (
              <Badge key={f.rule} tone="accent">
                {f.rule === "spread" ? "Different angle" : "Cooldown"}
              </Badge>
            ))}
          </div>
          <p className="text-[15px]">{reason}</p>
          {s.flags.map((f) => (
            <p key={f.rule} className="text-[13px] text-muted">
              {GUARDRAIL_LABEL[f.rule]}: {f.note}
            </p>
          ))}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] sm:flex sm:flex-wrap sm:gap-x-6">
            <div className="contents sm:flex sm:gap-2">
              <dt className="text-muted">Next window</dt>
              <dd data-next-window>{nextWindowText(s)}</dd>
            </div>
            <div className="contents sm:flex sm:gap-2">
              <dt className="text-muted">Load</dt>
              <dd className="font-mono">
                {s.load.count} of {s.load.max} asks this week
              </dd>
            </div>
            <div className="contents sm:flex sm:gap-2">
              <dt className="text-muted">Score</dt>
              <dd className="font-mono">{fmt(s.score)}</dd>
            </div>
          </dl>
          {strip || s.availability.recommendation ? (
            <div className="grid gap-3 pt-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
              {strip ? <div className="min-w-0">{strip}</div> : null}
              {s.availability.recommendation ? <RecommendationBox rec={s.availability.recommendation} personId={s.employeeId} /> : null}
            </div>
          ) : null}
        </div>
        <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:flex-col sm:items-end">
          {canChoose ? (
            <Button size="sm" variant={s.rank === 1 ? "primary" : "secondary"} disabled={busy} onClick={() => onChoose(s)}>
              Ask {firstName(s.name)}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={`bd-${s.employeeId}`} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide breakdown" : "Score breakdown"}
          </Button>
        </div>
      </div>
      {open ? (
        <div id={`bd-${s.employeeId}`}>
          <Breakdown s={s} person={person} weights={weights} />
          <p className="border-t border-line bg-sunken px-4 py-3 text-[12px] text-muted">
            {REASON_SOURCE_LINE[source]}
            {person?.reasonDropped ? ` The model's sentence was dropped because it named something not in this evidence.` : ""}
          </p>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The shortlist state. Ranking already happened on the server; this component re-runs the same
 * pure rankCandidates on the stored components whenever the tune control moves, so the order,
 * the guardrails and the why-not line update instantly with no request.
 */
/**
 * `compact` (the guided demo) shows only the ranked rows: no intro, tune control, why-not, fairness
 * table, exclusions or footer, because the demo step explains those in a line of its own.
 */
export function Shortlist({
  askId,
  view,
  canChoose,
  strips,
  openFor,
  compact = false,
}: {
  askId: string;
  view: RankingView;
  canChoose: boolean;
  strips?: Record<string, ReactNode>;
  openFor?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tune, setTune] = useState(0);
  const [busy, setBusy] = useState(false);
  const { summary, people } = view;
  const byId = useMemo(() => new Map(people.map((p) => [p.features.employeeId, p])), [people]);
  const outcome = useMemo(
    () =>
      rankCandidates(
        people.map((p) => p.features),
        { tune, cooled: summary.cooled },
      ),
    [people, summary.cooled, tune],
  );
  const firstRun = useRef(true);

  useEffect(() => {
    const order = outcome.shortlist.map((s) => s.employeeId);
    const fired = outcome.guardrails.filter((r) => r.fired).map((r) => r.rule);
    if (firstRun.current) {
      firstRun.current = false;
      const same = order.join(",") === summary.shortlistIds.join(",");
      if (same) log.info(`${askId} shortlist shown as ranked on the server: ${order.join(", ")}`, { askId });
      else log.warn(`${askId} client re-rank at tune 0 differs from the server (${summary.config}): client ${order.join(",")} vs server ${summary.shortlistIds.join(",")}`, { askId });
      return;
    }
    const label = TUNE_STOPS.find((x) => x.value === tune)?.label ?? String(tune);
    log.info(`${askId} tune "${label}" (${tune}): ${outcome.shortlist.map((s) => `#${s.rank} ${s.employeeId} ${s.score}`).join(", ")}; guardrails fired: ${fired.join(", ") || "none"}`, {
      askId,
      weights: outcome.weights,
    });
  }, [askId, outcome, summary.config, summary.shortlistIds, tune]);

  async function choose(s: Ranked) {
    setBusy(true);
    log.info(`${askId} choose ${s.employeeId} (#${s.rank} at tune ${tune})`, {
      askId,
    });
    try {
      await runAction("ask.choose", chooseCandidate, {
        askId,
        employeeId: s.employeeId,
        tune,
        shownRank: s.rank,
      });
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error(`${askId} choose failed`, { err, code: e?.code });
      toast.show({
        kind: "error",
        title: `Could not choose ${firstName(s.name)}`,
        body: e?.message ?? String(err),
        code: e?.code ?? "UNKNOWN",
      });
      setBusy(false);
    }
  }

  const whyNot = outcome.whyNot;
  const whyNotName = whyNot ? (byId.get(whyNot.employeeId)?.features.name ?? "") : "";

  return (
    <div className="grid gap-6">
      {compact ? null : (
        <>
          <div className="grid gap-2">
            <h2 className="text-[15px] font-semibold">Who to ask</h2>
            <p className="text-[13px] text-muted">
              Ranked by code, not by a model: ownership, skills, how recently they worked on it, when they are free, mentoring fit, team and time zone, minus a penalty for asks they already have this
              week. The model only writes each one-line reason, from that person&apos;s evidence alone. A reason that names anything not in the evidence is replaced by a template.
            </p>
            {summary.explain.note ? <p className="font-mono text-[12px] text-muted">{summary.explain.note}</p> : null}
            {summary.clock?.pinned ? (
              <p className="text-[12px] text-muted" data-demo-clock>
                Demo clock: free and busy times are as of <span className="font-mono">{clockLabel(new Date(summary.clock.now))}</span>, a fixed moment inside the seeded calendars, so this demo shows
                the same times whenever it runs.
              </p>
            ) : null}
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-[13px] font-medium">Weigh toward</legend>
            <div className="grid grid-cols-5 border border-line-strong" role="radiogroup">
              {TUNE_STOPS.map((stop) => {
                const on = stop.value === tune;
                return (
                  <label
                    key={stop.value}
                    className={`flex min-h-10 cursor-pointer items-center justify-center border-l border-line-strong px-1 text-center text-[12px] leading-tight transition-colors duration-100 first:border-l-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] sm:text-[13px] ${on ? "bg-fg font-semibold text-bg" : "bg-raised text-fg active:bg-strong"}`}
                  >
                    <input type="radio" name={`tune-${askId}`} value={stop.value} checked={on} onChange={() => setTune(stop.value)} className="sr-only" />
                    {stop.label}
                  </label>
                );
              })}
            </div>
            <p className="text-[12px] text-muted">Expertise weighs ownership, skills and recency up. Speed weighs free time, time zone and spare capacity up. Re-ranks here, with no new request.</p>
          </fieldset>

          {whyNot ? (
            <div className="border border-line-strong bg-sunken px-4 py-3" data-why-not={whyNot.employeeId}>
              <p className="text-[13px] font-semibold">Why not {firstName(whyNotName)}?</p>
              <p className="mt-1 text-[15px]">{whyNot.text}</p>
            </div>
          ) : null}
        </>
      )}

      {outcome.shortlist.length && strips ? (
        <div className="-mb-3">
          <StripLegend zoneLabel="each person's own" />
        </div>
      ) : null}
      {outcome.shortlist.length ? (
        <ol className="grid gap-3" aria-label="Shortlist">
          {outcome.shortlist.map((s) => (
            <Row
              key={s.employeeId}
              s={s}
              person={byId.get(s.employeeId)}
              weights={outcome.weights}
              canChoose={canChoose}
              busy={busy}
              onChoose={choose}
              strip={strips?.[s.employeeId]}
              defaultOpen={s.employeeId === openFor}
            />
          ))}
        </ol>
      ) : (
        <EmptyState
          title="Nobody can take this ask right now"
          body={
            outcome.excluded.length
              ? "Everyone with evidence is at their weekly ask limit or out of office. Their names and reasons are below."
              : "Nobody had evidence for this ask. Name the service or tool and ask again."
          }
        />
      )}

      {compact ? null : (
        <>
          <section aria-labelledby="fair-h" className="grid gap-2">
            <h3 id="fair-h" className="text-[14px] font-semibold">
              Fairness checks
            </h3>
            <Table>
              <THead>
                <TR>
                  <TH>Rule</TH>
                  <TH>Result</TH>
                  <TH>Detail</TH>
                </TR>
              </THead>
              <TBody>
                {outcome.guardrails.map((r) => (
                  <TR key={r.rule} data-guardrail={r.rule} data-fired={r.fired}>
                    <TD className="whitespace-nowrap">{GUARDRAIL_LABEL[r.rule]}</TD>
                    <TD>{r.fired ? <Badge tone="accent">Fired</Badge> : <Badge>Not needed</Badge>}</TD>
                    <TD className="text-[13px]">{r.summary}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>

          {outcome.excluded.length ? (
            <section aria-labelledby="excl-h" className="grid gap-2">
              <h3 id="excl-h" className="text-[14px] font-semibold">
                Left off the shortlist on purpose
              </h3>
              <ul className="divide-y divide-line border border-line">
                {outcome.excluded.map((s) => (
                  <li key={s.employeeId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm" data-excluded={s.excluded?.rule}>
                    <Link href={`/directory/${s.employeeId}`} className="font-semibold">
                      {s.name}
                    </Link>
                    <span className="text-muted">{s.title}</span>
                    <Badge tone="danger">{s.excluded?.rule === "hard_cap" ? "At limit" : "Away"}</Badge>
                    <span className="basis-full text-[13px]">
                      {firstName(s.name)} is {s.excluded?.reason}.{" "}
                      {s.ownerOf.length ? `${s.ownerOf.map((o) => `${o.role === "primary" ? "Owns" : "Backup owner of"} ${o.serviceName}`).join("; ")}.` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {outcome.rest.length ? (
            <details className="border border-line">
              <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium">Everyone else considered ({outcome.rest.length})</summary>
              <Table className="border-0">
                <THead>
                  <TR>
                    <TH>Person</TH>
                    <TH className="text-right">Score</TH>
                    <TH>Biggest factor</TH>
                  </TR>
                </THead>
                <TBody>
                  {outcome.rest.map((s) => (
                    <TR key={s.employeeId}>
                      <TD>
                        <Link href={`/directory/${s.employeeId}`}>{s.name}</Link> <span className="text-[12px] text-muted">{s.title}</span>
                      </TD>
                      <TD mono className="text-right">
                        {fmt(s.score)}
                      </TD>
                      <TD className="text-[13px]">{templateReason(s)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </details>
          ) : null}

          <p className="text-[12px] text-muted">
            Ranked with <span className="font-mono">{summary.config}</span> at {summary.rankedAt.replace("T", " ").slice(0, 16)} UTC for {summary.horizon}, availability from{" "}
            <span className="font-mono">{summary.availabilityProvider}</span>. To follow this decision in the log, search for <span className="font-mono">{askId} score</span>.
          </p>
        </>
      )}
    </div>
  );
}
