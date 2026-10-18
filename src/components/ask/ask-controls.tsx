"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { abandonAsk, retryAsk } from "@/app/ask/actions";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";

const log = createLogger("ask.controls");

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(name: string, fn: () => Promise<unknown>, failTitle: string) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error(`${name} failed`, { err, code: e?.code });
      toast.show({ kind: "error", title: failTitle, body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

export function AbandonButton({ askId }: { askId: string }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useRun();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
        Abandon ask
      </Button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Abandon this ask?"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                log.info(`${askId} abandon confirmed`, { askId });
                void run("ask.abandon", () => runAction("ask.abandon", abandonAsk, { askId }), "Could not abandon the ask");
              }}
            >
              Abandon
            </Button>
          </>
        }
      >
        <p>It moves to Abandoned and stays in your history. This cannot be undone.</p>
      </Dialog>
    </>
  );
}

export function RetryButton({ askId, label = "Try again" }: { askId: string; label?: string }) {
  const { busy, run } = useRun();
  return (
    <Button
      variant="primary"
      disabled={busy}
      onClick={() => {
        log.info(`${askId} retry clicked`, { askId });
        void run("ask.retry", () => runAction("ask.retry", retryAsk, { askId }), "Could not submit the ask again");
      }}
    >
      {busy ? "Submitting..." : label}
    </Button>
  );
}
