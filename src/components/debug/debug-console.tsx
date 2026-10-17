"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/client-log";
import { type DebugEntry, clearEntries, toPlainText, useDebugState } from "@/lib/debug-store";
import { Button } from "../ui/button";
import { SkeletonTable } from "../ui/skeleton";
import { ErrorState } from "../ui/states";
import { Tabs } from "../ui/tabs";
import { LogView } from "./log-view";

const log = createLogger("debug.page");

function download(entries: readonly DebugEntry[], label: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([toPlainText(entries, label) + "\n"], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `who2ask-log-${label.replace(/\s+/g, "-")}-${stamp}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  log.info(`downloaded ${entries.length} lines`, { label });
}

export function DebugConsole() {
  const view = useSearchParams().get("view") === "server" ? "server" : "session";
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label="Log source"
        items={[
          { href: "/debug", label: "This tab's session" },
          { href: "/debug?view=server", label: "Server ring buffer" },
        ]}
      />
      {view === "session" ? <SessionLog /> : <ServerLog />}
    </div>
  );
}

function SessionLog() {
  const { entries } = useDebugState();
  return (
    <div className="border border-line bg-raised">
      <LogView
        entries={entries}
        label="session"
        heightClass="h-[65vh]"
        actions={
          <>
            <Button size="sm" onClick={() => download(entries, "session")}>
              Download
            </Button>
            <Button size="sm" variant="ghost" onClick={clearEntries}>
              Clear
            </Button>
          </>
        }
      />
    </div>
  );
}

type ServerState = { status: "loading" } | { status: "error"; code: string; reqId: string | null } | { status: "ready"; entries: DebugEntry[] };

function ServerLog() {
  const [state, setState] = useState<ServerState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await apiFetch<{ lines: string[] }>("/api/debug/logs");
      setState({ status: "ready", entries: res.lines.map((line, i) => ({ id: i + 1, source: "server" as const, line })) });
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      log.error("could not load server ring buffer", { err, code: e?.code });
      setState({ status: "error", code: e?.code ?? "UNKNOWN", reqId: e?.reqId ?? null });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") return <SkeletonTable rows={10} cols={1} />;
  if (state.status === "error") {
    return (
      <ErrorState
        title="Could not load server logs"
        code={state.code}
        reqId={state.reqId}
        action={
          <Button variant="secondary" onClick={load}>
            Retry
          </Button>
        }
      />
    );
  }
  return (
    <div className="border border-line bg-raised">
      <LogView
        entries={state.entries}
        label="server"
        heightClass="h-[65vh]"
        actions={
          <>
            <Button size="sm" onClick={() => download(state.entries, "server")}>
              Download
            </Button>
            <Button size="sm" variant="ghost" onClick={load}>
              Refresh
            </Button>
          </>
        }
      />
    </div>
  );
}
