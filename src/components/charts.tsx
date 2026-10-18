// Hand-drawn SVG charts (no chart library). Plain bordered bars and plain lines in the single
// accent, square ends, no animation. Text is HTML around the SVG so it stays readable at phone
// width; the SVG itself stretches (preserveAspectRatio none) with non-scaling strokes. Each mark has
// a <title>, so hovering shows its value, and every chart sits next to a table with the numbers.

import type { ReactNode } from "react";
import { cn } from "./ui/cn";

/** The plain state for a cell under the k-anonymity threshold. */
export function Suppressed({ className, short = false }: { className?: string; short?: boolean }) {
  return <span className={cn("text-[12px] text-subtle", className)}>{short ? "under 5" : "not enough data"}</span>;
}

/** One horizontal bar, 0..max. null draws an empty dashed track (suppressed). */
export function Bar({ value, max, title, className }: { value: number | null; max: number; title: string; className?: string }) {
  const pct = value === null || max <= 0 ? 0 : Math.max(0.5, (value / max) * 100);
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className={cn("block h-3 w-full", className)} role="img" aria-label={title}>
      <title>{title}</title>
      {value === null ? (
        <rect x="0.5" y="0.5" width="99" height="9" fill="none" stroke="var(--border)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      ) : (
        <rect x="0" y="0.5" width={pct} height="9" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

export type BarItem = { key: string; label: ReactNode; value: number | null; display: ReactNode; title: string };

/** A labelled bar list: label, bar, value. Suppressed rows keep their place with a plain note. */
export function BarList({ items, max, className }: { items: BarItem[]; max?: number; className?: string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value ?? 0));
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5rem]">
          <span className="min-w-0 truncate">{i.label}</span>
          <Bar value={i.value} max={m} title={i.title} />
          <span className="text-right font-mono text-[12px]">{i.value === null ? <Suppressed short /> : i.display}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A small line for one series over a few points (small multiples, so one color is enough).
 * null points are suppressed: the line breaks there and a short dashed tick marks the gap.
 */
export function Sparkline({ values, max, titles, className }: { values: Array<number | null>; max: number; titles: string[]; className?: string }) {
  const n = values.length;
  const x = (i: number) => (n <= 1 ? 50 : 4 + (i * 92) / (n - 1));
  const y = (v: number) => 28 - (max > 0 ? (v / max) * 24 : 0);
  const segments: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
    } else cur.push(`${x(i)},${y(v)}`);
  });
  if (cur.length) segments.push(cur.join(" "));
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("block h-8 w-full", className)} role="img" aria-label={titles.join("; ")}>
      <line x1="0" y1="28.5" x2="100" y2="28.5" stroke="var(--border)" vectorEffect="non-scaling-stroke" />
      {segments.map((pts, i) =>
        pts.includes(" ") ? (
          <polyline key={i} points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        ) : (
          <line key={i} x1={Number(pts.split(",")[0]) - 1.5} y1={pts.split(",")[1]} x2={Number(pts.split(",")[0]) + 1.5} y2={pts.split(",")[1]} stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        ),
      )}
      {values.map((v, i) => (
        <g key={`p${i}`}>
          <title>{titles[i]}</title>
          {v === null ? (
            <line x1={x(i)} y1="20" x2={x(i)} y2="28" stroke="var(--border-strong)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          ) : null}
          {/* Hit target for the tooltip, wider than the mark. */}
          <rect x={x(i) - 4} y="0" width="8" height="30" fill="transparent" />
        </g>
      ))}
    </svg>
  );
}

/**
 * Concentration curve: cumulative share of routed asks (y) against people ranked by asks received
 * (x). The dashed diagonal is an even spread. Axis text is HTML.
 */
export function ConcentrationCurve({ curve, people, marks }: { curve: number[]; people: number; marks: Array<{ at: number; label: string }> }) {
  const n = Math.max(1, curve.length - 1);
  const pts = curve.map((c, i) => `${(i / n) * 100},${100 - c * 100}`).join(" ");
  return (
    <figure className="m-0">
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
        <div className="flex h-48 flex-col justify-between text-right font-mono text-[11px] text-subtle" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="block h-48 w-full border-b border-l border-line" role="img" aria-label={`Cumulative share of routed asks across ${curve.length - 1} recipients`}>
          <line x1="0" y1="50" x2="100" y2="50" stroke="var(--border)" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="100" x2="100" y2="0" stroke="var(--border-strong)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {marks.map((m) => (
            <g key={m.at}>
              <title>{m.label}</title>
              <line x1={(m.at / n) * 100} y1="0" x2={(m.at / n) * 100} y2="100" stroke="var(--fg-subtle)" strokeDasharray="1 3" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
      </div>
      <div className="ml-[3rem] mt-1 flex justify-between font-mono text-[11px] text-subtle" aria-hidden="true">
        <span>most asked</span>
        <span>{curve.length - 1} people who received any</span>
      </div>
      <figcaption className="mt-2 text-[12px] text-muted">
        Line: share of all routed asks received by the most asked people so far. Dashed diagonal: every recipient taking the same share. {people} people in the
        company.
      </figcaption>
    </figure>
  );
}

/** One series over weeks, with the week labels and values as HTML underneath. null = suppressed. */
export function WeekLine({ points, label }: { points: Array<{ label: string; value: number | null }>; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.value ?? 0));
  return (
    <figure className="m-0">
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
        <div className="flex h-32 flex-col justify-between text-right font-mono text-[11px] text-subtle" aria-hidden="true">
          <span>{max}</span>
          <span>0</span>
        </div>
        <div className="border-b border-l border-line px-3">
          <Sparkline values={points.map((p) => p.value)} max={max} titles={points.map((p) => `${p.label}: ${p.value === null ? "not enough data" : p.value}`)} className="h-32" />
        </div>
      </div>
      <div className="ml-[3rem] mt-1 grid px-3 font-mono text-[11px] text-subtle" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
        {points.map((p, i) => (
          <span key={p.label} className={i === 0 ? "text-left" : i === points.length - 1 ? "text-right" : "text-center"}>
            {p.label}
            <span className="block text-fg">{p.value === null ? "under 5" : p.value}</span>
          </span>
        ))}
      </div>
      <figcaption className="mt-2 text-[12px] text-muted">{label}</figcaption>
    </figure>
  );
}
