"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, runAction } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { reseed } from "./actions";

const log = createLogger("admin.seed");

export function ReseedForm({ currentSeed, defaultSeed, fixtureSeed }: { currentSeed: string | null; defaultSeed: string; fixtureSeed: string | null }) {
  const [seed, setSeed] = useState(currentSeed ?? defaultSeed);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const usesFixture = seed.trim() === fixtureSeed;

  async function run() {
    setConfirming(false);
    setBusy(true);
    log.info("reseed requested", { seed, usesFixture });
    try {
      const r = await runAction("admin.reseed", reseed, { seed: seed.trim() });
      toast.show({
        kind: "success",
        title: `Reseeded "${r.seed}" in ${r.totalMs}ms`,
        body: `${r.counts.employees} employees, ${r.counts.calendar_events} calendar events, ${r.counts.asks} asks. Text: ${r.textSource}.`,
      });
      if (r.warnings.length) log.warn("reseed finished with warnings", { warnings: r.warnings });
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("reseed failed", { err, code: e?.code });
      toast.show({ kind: "error", title: "Reseed failed", body: e?.message ?? String(err), code: e?.code ?? "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirming(true);
      }}
    >
      <Field
        label="Seed string"
        htmlFor="seed"
        hint={
          usesFixture
            ? "Matches the committed fixture: free, offline and identical every time."
            : "No fixture for this seed: the company is generated in memory with templated text. Still deterministic."
        }
      >
        <Input id="seed" name="seed" value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={40} className="font-mono" required />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={busy || !seed.trim()}>
          {busy ? "Reseeding..." : "Reseed"}
        </Button>
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Replace the synthetic company?"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" onClick={run}>
              Reseed now
            </Button>
          </>
        }
      >
        <p>
          This deletes every employee, calendar, project, document and ask, including asks made by real accounts, then loads seed{" "}
          <span className="font-mono">{seed.trim()}</span>.
        </p>
        <p className="mt-2 text-muted">Accounts and usage records are kept. Accounts keep their persona if the new company has the same employee id.</p>
      </Dialog>
    </form>
  );
}
