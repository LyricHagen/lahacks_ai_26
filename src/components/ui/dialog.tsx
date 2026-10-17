"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "./button";
import { cn } from "./cn";

/**
 * Native <dialog>, for confirmations and short forms only. Anything a user might want to link
 * to gets its own route instead (CLAUDE.md: no modal-only views).
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
      className={cn("m-auto w-[min(32rem,calc(100vw-2rem))] border border-line-strong bg-raised text-fg p-0", className)}
    >
      <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
        <h2 id="dialog-title" className="text-[15px] font-semibold">
          {title}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
          Close
        </Button>
      </header>
      <div className="px-4 py-4 text-sm">{children}</div>
      {footer ? <footer className="flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3">{footer}</footer> : null}
    </dialog>
  );
}
