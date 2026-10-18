"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { setInsightsOptIn } from "./actions";

const log = createLogger("insights.opt_in");

/** The org-level switch. Shown to everyone; only admins can press it. */
export function OptInToggle({ on, canChange }: { on: boolean; canChange: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function flip() {
    setBusy(true);
    log.info(`insights opt-in toggle: turning it ${on ? "off" : "on"}`);
    try {
      await runAction("insights.opt_in", setInsightsOptIn, { on: !on });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("insights opt-in change failed", { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not change the opt-in", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span role="switch" aria-checked={on} aria-label="Org opt-in for insights" className="inline-flex border border-line-strong font-mono text-[12px]">
        <span className={on ? "bg-fg px-2 py-1 text-bg" : "px-2 py-1 text-muted"}>ON</span>
        <span className={on ? "px-2 py-1 text-muted" : "bg-fg px-2 py-1 text-bg"}>OFF</span>
      </span>
      {canChange ? (
        <Button size="sm" onClick={() => setConfirming(true)} disabled={busy}>
          {on ? "Turn off for the org" : "Turn on for the org"}
        </Button>
      ) : (
        <span className="text-[12px] text-muted">Only an admin can change this.</span>
      )}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={on ? "Turn insights off for the org?" : "Turn insights on for the org?"}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="primary" onClick={flip} disabled={busy}>
              {busy ? "Saving..." : on ? "Turn off" : "Turn on"}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {on
            ? "Every panel on this page stops loading for everyone, and no aggregate query runs until an admin turns it back on."
            : "Everyone who opens this page sees the aggregate panels. Cells with fewer than five asks stay hidden either way."}
        </p>
      </Dialog>
    </div>
  );
}
