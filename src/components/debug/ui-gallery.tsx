"use client";

import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { ASK_STATES } from "@/lib/ask-state";
import type { StripSegment, WeekStripData } from "@/lib/availability-types";
import { AskProgress } from "../ask/ask-progress";
import { NotBuiltPanel } from "../ask/not-built";
import { RecommendationBox } from "../availability/recommendation";
import { WeekStrip, WeekStripSkeleton } from "../availability/week-strip";
import { BarList, ConcentrationCurve, Suppressed, WeekLine } from "../charts";
import { AskStateBadge } from "../ask/state-badge";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "../ui/card";
import { Dialog } from "../ui/dialog";
import { Field, Input, Select, Textarea } from "../ui/field";
import { SkeletonBlock, SkeletonCard, SkeletonList, SkeletonTable, SkeletonText } from "../ui/skeleton";
import { EmptyState, ErrorState } from "../ui/states";
import { TBody, TD, TH, THead, TR, Table } from "../ui/table";
import { useToast } from "../ui/toast";

const log = createLogger("debug.ui");

/** A fixed sample week (no clock): Monday half past, a focus morning, an absence on Thursday. */
const SAMPLE_STRIP: WeekStripData = (() => {
  const day = (pattern: string): StripSegment[] => [...pattern].map((c) => (c === "h" ? "hard" : c === "s" ? "soft" : "free"));
  const mk = (i: number, wd: string, pattern: string | null, extra: Partial<WeekStripData["days"][number]> = {}) => {
    const segments = pattern ? day(pattern) : [];
    const n = (k: StripSegment) => segments.filter((x) => x === k).length * 30;
    return { date: `2026-10-${19 + i}`, weekdayShort: wd, dayOfMonth: String(19 + i), today: i === 0, weekend: false, ooo: false, segments, pastSegments: 0, hardMinutes: n("hard"), softMinutes: n("soft"), freeMinutes: n("free"), ...extra };
  };
  return {
    employeeId: "emp_113",
    tz: "America/Los_Angeles",
    zoneLabel: "Pacific",
    startMin: 540,
    endMin: 1050,
    segmentMinutes: 30,
    days: [
      mk(0, "Mon", "fhssssffhhfssssff", { pastSegments: 3 }),
      mk(1, "Tue", "fhffhhffffhffffff"),
      mk(2, "Wed", "hhhhhhhffhhhhhhhh"),
      mk(3, "Thu", null, { ooo: true }),
      mk(4, "Fri", "fhssssfffffffffff"),
      mk(5, "Sat", null, { weekend: true }),
      mk(6, "Sun", null, { weekend: true }),
    ],
  };
})();

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line pt-6 lg:grid-cols-[12rem_1fr]">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function UiGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function triggerServerError() {
    try {
      await apiFetch("/api/debug/fail?code=RANK_TIMEOUT");
      toast.show({ kind: "info", title: "The failure endpoint unexpectedly succeeded" });
    } catch (err) {
      const e = err as ApiError;
      toast.show({ kind: "error", title: "Request failed", body: e.reqId ? `request ${e.reqId}` : undefined, code: e.code });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Draft</Badge>
          <Badge tone="accent">Pending</Badge>
          <Badge tone="success">Free</Badge>
          <Badge tone="danger">Busy</Badge>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid max-w-md gap-4">
          <Field label="Your problem" htmlFor="g-ask" hint="Plain words are fine.">
            <Textarea id="g-ask" placeholder="I need access to..." />
          </Field>
          <Field label="Team" htmlFor="g-team" error="Pick a team">
            <Select id="g-team" aria-invalid="true" defaultValue="">
              <option value="" disabled>
                Choose
              </option>
              <option>Data Platform</option>
              <option>Billing Engineering</option>
            </Select>
          </Field>
          <Field label="Email" htmlFor="g-email">
            <Input id="g-email" type="email" placeholder="you@example.com" />
          </Field>
        </div>
      </Section>

      <Section title="Card and table">
        <Card>
          <CardHeader title="Shortlist" meta="3 candidates" actions={<Button size="sm">Export</Button>} />
          <CardBody className="p-0">
            <Table className="border-0">
              <THead>
                <TR>
                  <TH>Person</TH>
                  <TH>Team</TH>
                  <TH>Score</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD>Priya Raman</TD>
                  <TD>Data Platform</TD>
                  <TD mono>0.82</TD>
                  <TD>
                    <Badge tone="success">Free</Badge>
                  </TD>
                </TR>
                <TR>
                  <TD>Marcus Oyelaran</TD>
                  <TD>Billing Eng</TD>
                  <TD mono>0.64</TD>
                  <TD>
                    <Badge tone="danger">Busy</Badge>
                  </TD>
                </TR>
              </TBody>
            </Table>
          </CardBody>
          <CardFooter>Scores are relative to this ask only.</CardFooter>
        </Card>
      </Section>

      <Section title="Skeletons">
        <div className="mb-3 flex gap-2">
          <Button size="sm" onClick={() => setLoading((l) => !l)}>
            {loading ? "Show loaded state" : "Show loading state"}
          </Button>
        </div>
        {loading ? (
          <div className="grid gap-4">
            <SkeletonText lines={3} />
            <SkeletonList count={3} />
            <SkeletonTable rows={3} cols={4} />
            <div className="grid gap-4 md:grid-cols-2">
              <SkeletonCard />
              <SkeletonBlock height={110} />
            </div>
          </div>
        ) : (
          <EmptyState title="Loaded" body="Toggle again to see the skeleton set." />
        )}
      </Section>

      <Section title="Availability">
        <div className="grid gap-6 sm:grid-cols-2">
          <WeekStrip data={SAMPLE_STRIP} />
          <WeekStripSkeleton />
        </div>
        <div className="mt-4 grid gap-3">
          <RecommendationBox
            personId="emp_113"
            rec={{ rule: "blocked_now_free_within_hour", channel: "dm", targetId: "emp_113", targetName: "Sophia Mitchell", headline: "DM Sophia asking for 10 minutes", reason: "You are blocked right now and Sophia is free now (today, 10:20 Pacific (10:20 their time)), so a short DM asking for 10 minutes gets you unblocked without a long wait." }}
          />
          <RecommendationBox
            personId="emp_113"
            rec={{ rule: "curious_async", channel: "async", targetId: "emp_113", targetName: "Sophia Mitchell", headline: "Send Sophia an async Slack message", reason: "You are not blocked, so an async message is the right ask: it does not take any of Sophia's time until they choose to answer, and nobody is interrupted." }}
          />
        </div>
      </Section>

      <Section title="Charts (insights)">
        <div className="grid gap-6">
          <BarList
            items={[
              { key: "a", label: "billing-service", value: 16, display: 16, title: "billing-service: 16 asks" },
              { key: "b", label: "mobile-ci", value: 13, display: 13, title: "mobile-ci: 13 asks" },
              { key: "c", label: "auth-gateway (under 5 asks)", value: null, display: null, title: "auth-gateway: not enough data" },
            ]}
          />
          <WeekLine label="Asks per week, with one week suppressed." points={[{ label: "Sep 28", value: 51 }, { label: "Oct 5", value: null }, { label: "Oct 12", value: 74 }]} />
          <ConcentrationCurve curve={[0, 0.09, 0.17, 0.25, 0.4, 0.55, 0.7, 0.85, 1]} people={200} marks={[{ at: 3, label: "top 3: 25%" }]} />
          <p className="text-sm">
            A suppressed cell reads: <Suppressed /> or <Suppressed short />
          </p>
        </div>
      </Section>

      <Section title="States">
        <div className="grid gap-4">
          <EmptyState title="No asks yet" body="Describe a problem to get your first shortlist." action={<Button variant="primary">New ask</Button>} />
          <ErrorState title="Ranking took too long" code="RANK_TIMEOUT" reqId="req_8f3a1c" body="Try again, or narrow the ask." />
        </div>
      </Section>

      <Section title="Ask lifecycle">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <div className="flex flex-wrap gap-2">
            {ASK_STATES.map((st) => (
              <AskStateBadge key={st} state={st} />
            ))}
          </div>
          <AskProgress state="retrieving" />
          <AskProgress state="stale" />
          <NotBuiltPanel state="shortlist" />
        </div>
      </Section>

      <Section title="Dialog and toast">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Button onClick={() => toast.show({ kind: "info", title: "Draft saved" })}>Info toast</Button>
          <Button onClick={() => toast.show({ kind: "success", title: "Marked as sent" })}>Success toast</Button>
          <Button
            onClick={() => {
              log.warn("demo error toast clicked");
              void triggerServerError();
            }}
          >
            Error toast from a real request
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Discard this draft?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setDialogOpen(false)}>
                Discard
              </Button>
            </>
          }
        >
          The edited message will be lost. The ask and its shortlist are kept.
        </Dialog>
      </Section>
    </div>
  );
}
