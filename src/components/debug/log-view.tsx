"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createLogger } from "@/lib/client-log";
import { type DebugEntry, filterEntries, toPlainText } from "@/lib/debug-store";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";

const log = createLogger("debug.view");

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and focus; fall back to a hidden textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const okCopy = document.execCommand("copy");
      ta.remove();
      return okCopy;
    } catch {
      return false;
    }
  }
}

function levelOf(line: string): string {
  const m = / (TRACE|DEBUG|INFO|WARN|ERROR) /.exec(line);
  return m?.[1] ?? "INFO";
}

const levelClass: Record<string, string> = {
  TRACE: "text-subtle",
  DEBUG: "text-muted",
  INFO: "text-fg",
  WARN: "text-accent font-medium",
  ERROR: "text-danger font-semibold",
};

/** Shared by the drawer and /debug: filter, copy buttons, and the line list (newest last). */
export function LogView({
  entries,
  label,
  actions,
  heightClass = "h-full",
  autoFocusFilter = false,
}: {
  entries: readonly DebugEntry[];
  label: string;
  actions?: ReactNode;
  heightClass?: string;
  autoFocusFilter?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const shown = useMemo(() => filterEntries(entries, filter), [entries, filter]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  async function copy(which: "all" | "last50") {
    const subset = which === "all" ? shown : shown.slice(-50);
    const desc = `${which === "all" ? "all" : "last 50"}${filter ? `, filter "${filter}"` : ""}`;
    const okCopy = await copyText(toPlainText(subset, `${label}, ${desc}`));
    setStatus(okCopy ? `Copied ${subset.length} lines` : "Copy failed, select the text manually");
    log.debug(okCopy ? `copied ${subset.length} lines` : "copy failed", { which, filter: filter || undefined });
    setTimeout(() => setStatus(null), 2500);
  }

  return (
    <div className={cn("flex min-h-0 flex-col", heightClass)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <label className="sr-only" htmlFor={`log-filter-${label}`}>
          Filter log lines
        </label>
        <input
          id={`log-filter-${label}`}
          autoFocus={autoFocusFilter}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter: req_ id, scope, level, text"
          className="h-8 min-w-0 flex-1 basis-48 border border-line-strong bg-raised px-2 font-mono text-[12px] placeholder:text-subtle"
        />
        <Button size="sm" onClick={() => copy("all")}>
          Copy all
        </Button>
        <Button size="sm" onClick={() => copy("last50")}>
          Copy last 50
        </Button>
        {actions}
        <span className="font-mono text-[12px] text-subtle" aria-live="polite">
          {status ?? `${shown.length}${filter ? ` of ${entries.length}` : ""} lines`}
        </span>
      </div>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-auto bg-sunken px-3 py-2 font-mono text-[12px] leading-[1.6]"
      >
        {shown.length === 0 ? (
          <p className="text-subtle">{entries.length === 0 ? "No log lines yet." : "No lines match the filter."}</p>
        ) : (
          shown.map((e) => (
            <div key={e.id} className={cn("flex gap-2 whitespace-pre-wrap break-all", levelClass[levelOf(e.line)])}>
              <span className="select-none text-subtle shrink-0 w-6">{e.source === "server" ? "srv" : "cli"}</span>
              <span>{e.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
