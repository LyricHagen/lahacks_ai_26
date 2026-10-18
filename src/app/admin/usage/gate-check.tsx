"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { runGateCheck } from "../users/actions";

const log = createLogger("admin.gate_check");

type Result = Awaited<ReturnType<typeof runGateCheck>> extends infer R ? (R extends { ok: true; data: infer D } ? D : never) : never;

/** Sends one tiny gate_check call through callModel, so the six checks can be watched in the log. */
export function GateCheck() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setBusy(true);
    try {
      const r = await runAction("admin.gate_check", runGateCheck, undefined);
      log.info(`gate check returned ${r.source}`, { outcome: r.outcome, mode: r.mode, modeReason: r.modeReason });
      setResult(r);
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("gate check failed", { err, code: e?.code });
      toast.show({ kind: "error", title: "Gate check failed", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <Button onClick={run} disabled={busy}>
          {busy ? "Running..." : "Run a gate check"}
        </Button>
      </div>
      {result ? (
        <div className="border border-line bg-sunken px-3 py-2">
          <p>{result.reply ?? "No reply."}</p>
          {result.note ? <p className="mt-1 text-[13px] text-muted">{result.note}</p> : null}
          <p className="mt-2 font-mono text-[12px] text-muted">
            source {result.source}, outcome {result.outcome}, mode {result.mode} ({result.modeReason}), tokens {result.tokens}
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-muted">One short call through callModel. In demo mode it returns the committed fixture and writes a zero-token usage row.</p>
      )}
    </div>
  );
}
