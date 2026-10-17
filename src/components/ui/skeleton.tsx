import type { CSSProperties } from "react";
import { cn } from "./cn";

// Skeletons are static blocks (no shimmer or pulse: CLAUDE.md allows no motion beyond
// short focus/active transitions). Compose them to match the real layout's shape.
//
//   <SkeletonList count={5} />                 a list of rows with avatar box + two lines
//   <SkeletonTable rows={8} cols={4} />         a table body
//   <SkeletonText lines={3} />                  a paragraph
//   <Skeleton className="h-40" />               any block

type Width = string | number;

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cn("bg-strong", className)} style={style} />;
}

export function SkeletonLine({ width = "100%", className }: { width?: Width; className?: string }) {
  return <Skeleton className={cn("h-3", className)} style={{ width }} />;
}

/** A paragraph of lines; the last line is shorter so it reads as text. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} width={i === lines - 1 && lines > 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

export function SkeletonBlock({ height = 120, className }: { height?: Width; className?: string }) {
  return <Skeleton className={className} style={{ height }} />;
}

export function SkeletonListItem({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0", className)}>
      <Skeleton className="h-9 w-9 shrink-0" />
      <div className="flex flex-1 flex-col gap-2">
        <SkeletonLine width="40%" />
        <SkeletonLine width="70%" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("border border-line", className)} role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonListItem key={i} />
      ))}
    </div>
  );
}

const ROW_WIDTHS = ["70%", "45%", "85%", "55%", "65%"];

export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <div className="grid gap-4 border-b border-line px-3 py-3 last:border-b-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: cols }, (_, i) => (
        <SkeletonLine key={i} width={ROW_WIDTHS[i % ROW_WIDTHS.length]} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("border border-line", className)} role="status" aria-busy="true" aria-label="Loading">
      <div className="grid gap-4 border-b border-line bg-sunken px-3 py-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }, (_, i) => (
          <SkeletonLine key={i} width="40%" className="h-2.5" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonTableRow key={i} cols={cols} />
      ))}
    </div>
  );
}

/** A Card-shaped placeholder: header bar plus a text body. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("border border-line bg-raised", className)} role="status" aria-busy="true" aria-label="Loading">
      <div className="border-b border-line px-4 py-3">
        <SkeletonLine width="35%" />
      </div>
      <div className="px-4 py-4">
        <SkeletonText lines={lines} />
      </div>
    </div>
  );
}
