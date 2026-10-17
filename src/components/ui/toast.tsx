"use client";

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { createLogger } from "@/lib/client-log";
import { cn } from "./cn";

type ToastKind = "info" | "success" | "error";
type ToastItem = { id: number; kind: ToastKind; title: string; body?: string; code?: string };

const ToastCtx = createContext<{ show: (t: Omit<ToastItem, "id">) => void } | null>(null);
const log = createLogger("ui.toast");

const kindLabel: Record<ToastKind, string> = { info: "Note", success: "Done", error: "Error" };
const kindClass: Record<ToastKind, string> = {
  info: "border-line-strong",
  success: "border-success",
  error: "border-danger",
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = nextId++;
      log.debug(`show ${t.kind}: ${t.title}`, t.code ? { code: t.code } : undefined);
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === "error" ? 9000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={cn("border bg-raised px-4 py-3 text-sm", kindClass[t.kind])}>
            <div className="flex items-start justify-between gap-3">
              <p>
                <span className={cn("font-semibold mr-2", t.kind === "error" && "text-danger", t.kind === "success" && "text-success")}>
                  {kindLabel[t.kind]}
                </span>
                {t.title}
              </p>
              <button type="button" onClick={() => dismiss(t.id)} className="text-muted hover:text-fg text-[13px] cursor-pointer" aria-label="Dismiss">
                Dismiss
              </button>
            </div>
            {t.body ? <p className="mt-1 text-muted">{t.body}</p> : null}
            {t.code ? <p className="mt-1 font-mono text-[12px] text-subtle">code {t.code}</p> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
