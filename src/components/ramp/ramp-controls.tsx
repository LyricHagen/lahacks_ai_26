"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dismissRampItem, undoRampDismissal } from "@/app/ramp/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";

const log = createLogger("ramp.item");

/** Dismiss (or undo) one plan item. Dismissing changes next week's plan, never this one's layout. */
export function RampItemControls({ weekStart, refId, title, dismissed, readOnly }: { weekStart: string; refId: string; title: string; dismissed: boolean; readOnly: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (readOnly) return null;
  async function run(kind: "dismiss" | "undo") {
    setBusy(true);
    log.info(`${kind} ${refId} (${title}) from week ${weekStart}`);
    try {
      if (kind === "dismiss") await runAction("ramp.dismiss", dismissRampItem, { weekStart, refId });
      else await runAction("ramp.undo", undoRampDismissal, { refId });
      toast.show({ kind: "success", title: kind === "dismiss" ? `Dismissed ${title}` : `${title} can come back`, body: kind === "dismiss" ? "Next week's plan leaves it out." : "Later plans may suggest it again." });
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error(`${kind} ${refId} failed`, { err, code: e?.code });
      toast.show({ kind: "error", title: kind === "dismiss" ? "Could not dismiss" : "Could not undo", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }
  return dismissed ? (
    <div className="flex flex-wrap items-center gap-3 text-[13px]">
      <span className="font-semibold">Dismissed.</span>
      <span className="text-muted">
        <Link href="/ramp/next">Next week&apos;s plan</Link> leaves it out.
      </span>
      <Button size="sm" variant="ghost" onClick={() => run("undo")} disabled={busy}>
        {busy ? "Undoing..." : "Undo"}
      </Button>
    </div>
  ) : (
    <Button size="sm" className="self-start" onClick={() => run("dismiss")} disabled={busy} aria-label={`Dismiss ${title}`}>
      {busy ? "Dismissing..." : "Not useful, dismiss"}
    </Button>
  );
}
