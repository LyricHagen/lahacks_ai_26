"use client";
// Guided step 7: "I sent this" on the guided ask, and the recipient's load counter moving. The
// same action as the draft page (markSent): it writes the `sent` transition that load counts.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markSent } from "@/app/ask/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import type { DraftFormat, DraftVariant } from "@/lib/draft";

const log = createLogger("demo.send");

export type SendPanelProps = {
  askId: string;
  recipient: { id: string; name: string; firstName: string };
  max: number;
  /** Load this week right now (before the send when not sent yet). */
  loadNow: number;
  sent: { loadBefore: number; loadAfter: number } | null;
  message: { variant: DraftVariant; format: DraftFormat; subject: string; body: string };
  canSend: boolean;
  serviceName: string;
};

function Counter({ label, n, max, strong }: { label: string; n: number; max: number; strong?: boolean }) {
  return (
    <div className={`grid gap-1 border px-4 py-3 ${strong ? "border-line-strong bg-raised" : "border-line bg-sunken"}`}>
      <span className="text-[12px] text-muted">{label}</span>
      <span className="font-mono text-[28px] font-semibold leading-none" data-load={n}>
        {n} <span className="text-[15px] font-normal text-muted">of {max}</span>
      </span>
    </div>
  );
}

export function DemoSendPanel(p: SendPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ loadBefore: number; loadAfter: number } | null>(p.sent);

  async function send() {
    setBusy(true);
    log.info(`${p.askId} I sent this (guided step), ${p.message.variant} as ${p.message.format}`, { askId: p.askId });
    try {
      const r = await runAction("ask.sent", markSent, { askId: p.askId, ...p.message });
      log.info(`${p.askId} load ${r.recipientId} ${r.loadBefore} -> ${r.loadAfter} of ${r.max}`, { askId: p.askId });
      setResult({ loadBefore: r.loadBefore, loadAfter: r.loadAfter });
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error(`${p.askId} mark sent failed`, { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not record the send", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }

  const atLimit = result ? result.loadAfter >= p.max : false;
  return (
    <div className="grid gap-4 border border-line-strong bg-raised px-5 py-4" data-sent={result ? "yes" : "no"}>
      <p className="text-[13px] font-medium">{p.recipient.name}, asks this week</p>
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Counter label={result ? "Before you sent it" : "Right now"} n={result ? result.loadBefore : p.loadNow} max={p.max} />
        <Counter label={result ? "After you sent it" : "After you send it"} n={result ? result.loadAfter : p.loadNow + 1} max={p.max} strong={!!result} />
      </div>
      {result ? (
        <p className="text-[15px]" role="status">
          Recorded. {p.recipient.firstName} now has {result.loadAfter} of {p.max} asks this week
          {atLimit ? `: at their weekly limit, so the next ask about ${p.serviceName} routes around them, the same way this one routed around the primary owner.` : "."}
        </p>
      ) : (
        <p className="text-sm text-muted">Nothing changes until you say you sent it. Who2Ask has no send button: you copy the draft and send it from your own Slack.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!result && p.canSend ? (
          <Button variant="primary" onClick={send} disabled={busy}>
            {busy ? "Recording..." : "I sent this"}
          </Button>
        ) : null}
        {result && p.canSend ? <Link href={`/ask/${p.askId}`}>See the follow-up card on the ask</Link> : null}
      </div>
    </div>
  );
}
