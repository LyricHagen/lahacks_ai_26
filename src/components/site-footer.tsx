"use client";

import Link from "next/link";
import { toggleDrawer, useDebugState } from "@/lib/debug-store";

export function SiteFooter() {
  const { open } = useDebugState();
  return (
    <footer className="mt-auto border-t border-line bg-sunken">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4 text-[13px] text-muted">
        <span>Who2Ask. Company data shown here is synthetic.</span>
        <Link href="/privacy" className="hover:text-fg">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-fg">
          Terms
        </Link>
        <Link href="/debug" className="hover:text-fg">
          Debug page
        </Link>
        <button
          type="button"
          onClick={toggleDrawer}
          aria-expanded={open}
          aria-controls="debug-drawer"
          className="ml-auto font-mono text-[12px] border border-line-strong px-2 py-0.5 hover:text-fg hover:bg-bg cursor-pointer"
        >
          {open ? "close log" : "log"} <span className="text-subtle">ctrl+`</span>
        </button>
      </div>
    </footer>
  );
}
