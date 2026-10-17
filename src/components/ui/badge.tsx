import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "danger" | "success";

// Tone is never the only signal: danger is bold and uppercase, success is uppercase,
// accent is medium weight, and the caller always passes a word ("Busy", "Free", "Pending").
const tones: Record<BadgeTone, string> = {
  neutral: "border-line-strong text-muted bg-transparent font-normal",
  accent: "border-accent text-accent bg-accent-soft font-medium",
  danger: "border-danger text-danger bg-danger-soft font-semibold uppercase tracking-wide",
  success: "border-success text-success bg-success-soft font-medium uppercase tracking-wide",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center border px-1.5 h-5 text-[11px] leading-none whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}
