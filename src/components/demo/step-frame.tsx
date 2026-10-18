import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DEMO_STEPS, type DemoStep, demoStepHref } from "@/lib/demo-script";
import { EnterDemoButton } from "./demo-controls";

/** The numbered path, every step a link, so a presenter can jump anywhere. Wraps at phone width. */
export function StepNav({ current }: { current?: string }) {
  return (
    <nav aria-label="Guided demo steps" className="mb-8">
      <ol className="flex flex-wrap gap-x-1 gap-y-1 border-b border-line pb-3 text-[13px]">
        {DEMO_STEPS.map((s, i) => {
          const on = s.slug === current;
          return (
            <li key={s.slug}>
              <Link
                href={demoStepHref(s.slug)}
                aria-current={on ? "step" : undefined}
                className={cn("inline-flex items-baseline gap-1.5 border px-2 py-1 no-underline transition-colors duration-100", on ? "border-fg bg-fg text-bg" : "border-line text-fg active:bg-strong")}
              >
                <span className="font-mono text-[12px]">{i + 1}</span>
                {s.short}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PrevNext({ prev, next }: { prev: DemoStep | null; next: DemoStep | null }) {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
      {prev ? (
        <ButtonLink href={demoStepHref(prev.slug)} variant="secondary">
          Back
        </ButtonLink>
      ) : (
        <ButtonLink href="/demo" variant="secondary">
          Back: overview
        </ButtonLink>
      )}
      {next ? (
        <ButtonLink href={demoStepHref(next.slug)} variant="primary">
          Next: {next.title}
        </ButtonLink>
      ) : null}
    </div>
  );
}

/** Shown on a step to anyone who is not in the demo account: the page reads fine, acting needs it. */
export function NotInDemo({ path, persona }: { path: string; persona: string | null }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-line bg-sunken px-4 py-3 text-sm">
      <p>
        You are only looking. Start the demo to click through it as {persona ?? "the demo new hire"}.
      </p>
      <EnterDemoButton next={path} size="sm" />
    </div>
  );
}
