"use client";
// Entering and resetting the guided demo. Both are one click; both say in the drawer and in a toast
// what happened (the reset's full account of what it removed is in the server log: "demo reset").

import { useRouter } from "next/navigation";
import { useState } from "react";
import { enterDemo, resetDemo } from "@/app/demo/actions";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";

const log = createLogger("demo.controls");

export function EnterDemoButton({ next, label = "Start the demo", variant = "primary", size = "md" }: { next?: string; label?: string; variant?: ButtonVariant; size?: ButtonSize }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function enter() {
    setBusy(true);
    log.info(`enter the demo${next ? `, then ${next}` : ""}`);
    try {
      const r = await runAction("demo.enter", enterDemo, { next });
      log.info(`signed in to the demo account, opening ${r.to}`, { guidedAskId: r.guidedAskId });
      router.push(r.to);
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("enter demo failed", { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not start the demo", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
      setBusy(false);
    }
  }
  return (
    <Button variant={variant} size={size} onClick={enter} disabled={busy}>
      {busy ? "Starting..." : label}
    </Button>
  );
}

export function ResetDemoButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function reset() {
    setBusy(true);
    log.info("reset demo clicked");
    try {
      const r = await runAction("demo.reset", resetDemo, undefined);
      log.info(`demo reset in ${r.ms}ms: ${r.deletedAsks} asks removed, ${r.loadsChanged} load counters changed, guided ${r.guidedAskId}; opening ${r.to}`);
      toast.show({ kind: "success", title: "Demo reset", body: `Back to the start in ${(r.ms / 1000).toFixed(1)}s: ${r.deletedAsks} demo asks removed, load counters restored, clock at ${r.clock}.` });
      router.push(r.to);
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("reset demo failed", { err, code: e?.code });
      toast.show({ kind: "error", title: "Could not reset the demo", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={reset} disabled={busy} className="cursor-pointer whitespace-nowrap font-medium text-fg underline underline-offset-2 disabled:cursor-wait disabled:opacity-60">
      {busy ? "Resetting..." : "Reset demo"}
    </button>
  );
}
