"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "./cn";

export type TabItem = { href: string; label: string; count?: number };

/**
 * Tabs are links, so each tab has its own URL (path segment or ?tab=). Never hide linkable
 * content behind client-only tab state. Active tab is marked with weight and an underline bar,
 * plus aria-current.
 */
export function Tabs({ items, className, label }: { items: TabItem[]; className?: string; label: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = pathname + (search.toString() ? `?${search.toString()}` : "");

  const isActive = (href: string) => (href.includes("?") ? current === href : pathname === href);

  return (
    <nav aria-label={label} className={cn("flex gap-0 border-b border-line overflow-x-auto", className)}>
      {items.map((t) => {
        const active = isActive(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "px-3 py-2 text-sm no-underline -mb-px border-b-2 whitespace-nowrap",
              active ? "border-fg text-fg font-semibold" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined ? <span className="ml-1.5 font-mono text-[12px] text-subtle">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
