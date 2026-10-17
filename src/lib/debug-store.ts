"use client";
// Browser-side session log: client log lines plus `_debug` lines from server responses, in
// arrival order (newest last). Persisted to sessionStorage so /debug shows the whole tab session.

import { useSyncExternalStore } from "react";

export type DebugEntry = { id: number; source: "client" | "server"; line: string };

const STORAGE_KEY = "w2a-debug-log";
const MAX_ENTRIES = 2000;

type State = { entries: DebugEntry[]; open: boolean };

let state: State = { entries: [], open: false };
let nextId = 1;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as DebugEntry[];
      nextId = (entries.at(-1)?.id ?? 0) + 1;
      state = { ...state, entries: [...entries, ...state.entries] };
    }
  } catch {
    // storage blocked or corrupt; start fresh (the console still has every line)
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
    } catch {
      // quota or blocked storage; not fatal
    }
  }, 250);
}

function emit() {
  for (const l of listeners) l();
}

export function pushEntries(source: DebugEntry["source"], lines: readonly string[]) {
  if (lines.length === 0) return;
  load();
  const added = lines.map((line) => ({ id: nextId++, source, line }));
  const entries = [...state.entries, ...added];
  state = { ...state, entries: entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries };
  persist();
  emit();
}

export function clearEntries() {
  state = { ...state, entries: [] };
  persist();
  emit();
}

export function setDrawerOpen(open: boolean) {
  state = { ...state, open };
  emit();
}

export function toggleDrawer() {
  setDrawerOpen(!state.open);
}

function subscribe(fn: () => void) {
  load();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const serverSnapshot: State = { entries: [], open: false };

export function useDebugState(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverSnapshot,
  );
}

/** Plain text for pasting into a chat: a header line, then one log line per row. */
export function toPlainText(entries: readonly DebugEntry[], label: string): string {
  const where = typeof window !== "undefined" ? window.location.pathname + window.location.search : "";
  const header = `# Who2Ask log, ${label}, ${entries.length} lines, page ${where}, copied ${new Date().toISOString()}`;
  return [header, ...entries.map((e) => e.line)].join("\n");
}

export function filterEntries(entries: readonly DebugEntry[], filter: string): DebugEntry[] {
  const f = filter.trim().toLowerCase();
  if (!f) return [...entries];
  return entries.filter((e) => e.line.toLowerCase().includes(f));
}
