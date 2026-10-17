"use client";
// Mounted once in the root layout. Wires up:
//  - Ctrl+` to toggle the drawer
//  - window error / unhandledrejection capture
//  - console.warn / console.error capture (React and Next warnings land in the drawer)
//  - a page-load ping on every navigation (client line + server line with a request id)

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { createLogger, writeClientLine } from "@/lib/client-log";
import { toggleDrawer } from "@/lib/debug-store";
import { DebugDrawer } from "./debug-drawer";

const log = createLogger("page");
const winLog = createLogger("window");

let consolePatched = false;
function patchConsole() {
  if (consolePatched) return;
  consolePatched = true;
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const first = typeof args[0] === "string" ? args[0] : "";
      // Our own lines already went to the drawer; do not record them twice.
      if (/^\[\d\d:\d\d:\d\d\.\d{3}\] \[/.test(first)) return;
      const text = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safe(a))).join(" ");
      const errArg = args.find((a) => a instanceof Error);
      writeClientLine(level, "console", text.slice(0, 2000), errArg ? { err: errArg } : undefined);
    };
  }
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function DebugProvider() {
  const pathname = usePathname();
  const search = useSearchParams();
  const lastPinged = useRef<string | null>(null);

  useEffect(() => {
    patchConsole();
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.code === "Backquote" || e.key === "`")) {
        e.preventDefault();
        toggleDrawer();
        log.trace("debug drawer toggled by keyboard");
      }
    };
    const onError = (e: ErrorEvent) => winLog.error(`uncaught: ${e.message}`, { err: e.error, src: e.filename, line: e.lineno });
    const onRejection = (e: PromiseRejectionEvent) => winLog.error("unhandled promise rejection", { err: e.reason });
    window.addEventListener("keydown", onKey);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    const path = pathname + (search.toString() ? `?${search.toString()}` : "");
    if (lastPinged.current === path) {
      log.skip("page-load ping", "same path as the last ping (React strict mode re-run)", { path });
      return;
    }
    lastPinged.current = path;
    const theme = document.documentElement.dataset.theme;
    log.info(`loaded ${path}`, { theme, viewport: `${window.innerWidth}x${window.innerHeight}` });
    apiFetch(`/api/debug/ping?path=${encodeURIComponent(path)}`).catch((err) => {
      log.error("page-load ping failed", { err, code: (err as { code?: string }).code });
    });
  }, [pathname, search]);

  return <DebugDrawer />;
}
