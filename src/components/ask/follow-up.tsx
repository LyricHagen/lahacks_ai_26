"use client";
// After "I sent this": waiting for an answer. Says plainly when it is reasonable to expect one
// (the ask's urgency horizon), and once that passes, suggests the next person on the shortlist
// without blaming the first. "They answered" closes the ask with an optional one line answer.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAnswered, tryNext } from "@/app/ask/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import type { FollowUp } from "@/lib/ask-outcome";
import { createLogger } from "@/lib/client-log";
import { ANSWER_NOTE_MAX } from "@/lib/draft";

const log = createLogger("ask.followup");

const waited = (m: number) => (m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : m < 60 * 24 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? "" : "s"}` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? "" : "s"}`);

export function FollowUpCard({ askId, f, canAct, stale }: { askId: string; f: FollowUp; canAct: boolean; stale: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [answering, setAnswering] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const first = f.recipientName.split(" ")[0];

  async function run(name: string, fn: () => Promise<unknown>, failTitle: string) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error(`${askId} ${name} failed`, { err, code: e?.code });
      toast.show({ kind: "error", title: failTitle, body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }

  const overdue = f.overdue || stale;
  return (
    <div className="grid gap-4 border border-line-strong bg-raised px-5 py-4" data-overdue={overdue}>
      <div className="grid gap-1">
        <p className="font-semibold">{overdue ? `No answer from ${first} yet` : `Sent to ${first}. Waiting for an answer.`}</p>
        <p className="text-sm">
          You marked it sent {waited(f.waitedMinutes)} ago ({f.sentLabel}). For this urgency an answer usually comes within {f.horizon}, so by about {f.deadlineLabel}.
        </p>
      </div>

      {overdue ? (
        <p className="text-sm">
          That time has passed. {first} may just be busy, not ignoring you: people get pulled into meetings and incidents.{" "}
          {f.next ? `You could ask ${f.next.name.split(" ")[0]}, next on your shortlist, without waiting any longer.` : "Nobody else is left on your shortlist; a short follow-up to the same person is fine."}
        </p>
      ) : (
        <p className="text-[13px] text-muted">
          {f.next ? `If nothing comes by then, ${f.next.name} is next on your shortlist. No answer usually means busy, not ignored.` : "Nobody else is left on your shortlist."}
        </p>
      )}

      {f.next ? (
        <div className={`grid gap-1 border px-3 py-2 ${overdue ? "border-accent bg-accent-soft" : "border-line bg-sunken"}`}>
          <p className="text-sm">
            <span className="font-semibold">Next: </span>
            <Link href={`/directory/${f.next.id}`}>{f.next.name}</Link>, {f.next.title}
            <span className="ml-2 font-mono text-[12px] text-muted">
              {f.next.load.count} of {f.next.load.max} asks this week at ranking
            </span>
          </p>
          {f.next.reason ? <p className="text-[13px]">{f.next.reason}</p> : null}
        </div>
      ) : null}

      {canAct ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => setAnswering(true)}>
            They answered
          </Button>
          {f.next ? (
            <Button
              variant={overdue ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => {
                log.info(`${askId} try next ${f.next!.id} clicked (${overdue ? "overdue" : "before the horizon"})`, { askId });
                void run("try next", () => runAction("ask.next", tryNext, { askId, employeeId: f.next!.id }), "Could not start a draft for the next person");
              }}
            >
              Ask {f.next.name.split(" ")[0]} instead
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={answering}
        onClose={() => setAnswering(false)}
        title={`${first} answered`}
        footer={
          <>
            <Button onClick={() => setAnswering(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                setAnswering(false);
                log.info(`${askId} answered confirmed, note ${note.trim() ? `${note.trim().length} chars` : "skipped"}`, { askId });
                void run("answered", () => runAction("ask.answered", markAnswered, { askId, note }), "Could not close the ask");
              }}
            >
              Close the ask
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="The answer, in one line (optional)" htmlFor="answer-note" hint={`Captured answers are how the company gets smarter: the next new hire with this question finds it here instead of asking ${first} again. ${note.length} of ${ANSWER_NOTE_MAX}.`}>
            <Input id="answer-note" value={note} maxLength={ANSWER_NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="It deduplicates on the event id in the webhook handler" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
