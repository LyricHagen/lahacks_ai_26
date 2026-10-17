"use client";

import Link from "next/link";
import { clearEntries, setDrawerOpen, useDebugState } from "@/lib/debug-store";
import { Button } from "../ui/button";
import { LogView } from "./log-view";

/** Bottom drawer, does not block the page. Toggle with Ctrl+` or the footer "log" button. */
export function DebugDrawer() {
  const { open, entries } = useDebugState();
  if (!open) return null;
  return (
    <aside
      id="debug-drawer"
      aria-label="Debug log"
      className="fixed inset-x-0 bottom-0 z-50 flex h-[45vh] flex-col border-t-2 border-fg bg-raised"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
        <p className="font-mono text-[12px]">
          <span className="font-semibold">debug log</span> <span className="text-subtle">client + server, newest last</span>
        </p>
        <div className="flex items-center gap-2">
          <Link href="/debug" className="text-[12px] text-muted hover:text-fg">
            Full page
          </Link>
          <Button size="sm" variant="ghost" onClick={() => setDrawerOpen(false)}>
            Close
          </Button>
        </div>
      </div>
      <LogView
        entries={entries}
        label="drawer"
        autoFocusFilter
        heightClass="flex-1 min-h-0"
        actions={
          <Button size="sm" variant="ghost" onClick={clearEntries}>
            Clear
          </Button>
        }
      />
    </aside>
  );
}
