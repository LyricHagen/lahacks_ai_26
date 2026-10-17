"use client";

import { useEffect, useState } from "react";
import { createLogger } from "@/lib/client-log";
import { cn } from "./ui/cn";

const log = createLogger("ui.toc");

type Heading = { id: string; text: string; level: 2 | 3 };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/**
 * Builds itself from the h2/h3 headings inside the element with id `rootId`. Headings without
 * an id get one, so every section is linkable (/privacy#data-we-store).
 *
 *   <div className="lg:grid lg:grid-cols-[1fr_14rem] gap-10">
 *     <article id="doc">...</article>
 *     <Toc rootId="doc" />
 *   </div>
 */
export function Toc({ rootId, className, title = "On this page" }: { rootId: string; className?: string; title?: string }) {
  const [headings, setHeadings] = useState<Heading[] | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) {
      log.warn(`no element with id "${rootId}", ToC left empty`);
      setHeadings([]);
      return;
    }
    const seen = new Set<string>();
    const found: Heading[] = [];
    root.querySelectorAll<HTMLHeadingElement>("h2, h3").forEach((h) => {
      if (h.dataset.tocSkip !== undefined) return;
      let id = h.id || slugify(h.textContent ?? "");
      while (seen.has(id)) id = `${id}-x`;
      seen.add(id);
      h.id = id;
      found.push({ id, text: h.textContent ?? "", level: h.tagName === "H2" ? 2 : 3 });
    });
    log.debug(`built ToC with ${found.length} headings`, { rootId });
    setHeadings(found);

    const els = found.map((f) => document.getElementById(f.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-64px 0px -70% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [rootId]);

  return (
    <nav aria-label={title} className={cn("text-[13px] lg:sticky lg:top-20 lg:self-start", className)}>
      <p className="mb-2 font-semibold text-fg">{title}</p>
      {headings === null ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[70, 55, 80, 45].map((w, i) => (
            <div key={i} className="h-2.5 bg-strong" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : headings.length === 0 ? (
        <p className="text-subtle">No sections.</p>
      ) : (
        <ol className="flex flex-col border-l border-line">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                aria-current={active === h.id ? "location" : undefined}
                className={cn(
                  "-ml-px block border-l py-1 no-underline",
                  h.level === 3 ? "pl-6" : "pl-3",
                  active === h.id ? "border-fg text-fg font-semibold" : "border-transparent text-muted hover:text-fg",
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
